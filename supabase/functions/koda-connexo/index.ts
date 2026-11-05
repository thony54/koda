// koda-connexo: puente KODA → Connexo Clients.
//
// KODA y Connexo son proyectos Supabase distintos. Esta función es el ÚNICO lugar de KODA que
// habla con Connexo, y lo hace con un secreto compartido (`x-koda-secret`) contra la función
// `kodaIntake` de Connexo: KODA nunca guarda la service_role de Connexo.
//
// Quién puede usarla: la cuenta propietaria o quien tenga el permiso `enviar_a_connexo`
// (ver can_send_connexo() en 0012). No la llama el cron.
//
// Acciones:
//   { action: 'enviar', prospect_ids: string[] }  → arma el borrador de cada prospecto en Connexo
//   { action: 'estado' }                          → refresca el estado de los envíos desde Connexo
//   { action: 'revision', envio_ids, paso }       → aprobar | devolver | descartar | restaurar | rellenar
//   { action: 'detalle', envio_id }               → qué se llenó, de dónde salió cada dato y el enlace de vista previa
//
// Opcional: CONNEXO_PUBLIC_URL (por defecto https://www.connexoapp.com) para armar el enlace a la vista previa.
//
// Secrets de esta función (supabase secrets set):
//   CONNEXO_BRIDGE_URL     https://<ref-de-connexo>.supabase.co/functions/v1/kodaIntake
//   CONNEXO_BRIDGE_SECRET  el mismo valor que KODA_BRIDGE_SECRET en las funciones de Connexo
import { corsHeaders, json } from '../_shared/cors.ts';
import { getAdminClient, requireCaller, type Caller } from '../_shared/supabaseAdmin.ts';
import { rubroDe } from '../_shared/rubros.ts';

const VERSION_CONTRATO = 1;
const MAX_POR_LLAMADA = 50;
const CONCURRENCIA = 3;
const TIMEOUT_MS = 30_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Celular de Ecuador en E.164 sin el "+": 5939 + 8 dígitos. Los fijos no reciben WhatsApp.
const MOVIL_EC_RE = /^5939\d{8}$/;

const ESTADOS = new Set([
  'pendiente', 'borrador', 'aprobado', 'wa_enviado', 'aceptado',
  'declinado', 'vencido', 'descartado', 'sin_plantilla', 'error',
]);
// Estados que ya no cambian: no vale la pena preguntarle a Connexo por ellos.
const ESTADOS_FINALES = ['descartado', 'vencido', 'sin_plantilla'];

// Pasos de revisión que KODA puede pedir (el servidor de Connexo valida cada transición).
const PASOS_REVISION: Record<string, { puente: 'estado_set' | 'rellenar'; estado?: string }> = {
  aprobar: { puente: 'estado_set', estado: 'aprobado' },
  devolver: { puente: 'estado_set', estado: 'borrador' },
  descartar: { puente: 'estado_set', estado: 'descartado' },
  restaurar: { puente: 'estado_set', estado: 'borrador' },
  rellenar: { puente: 'rellenar' },
};

const puenteConfigurado = () => !!Deno.env.get('CONNEXO_BRIDGE_URL') && !!Deno.env.get('CONNEXO_BRIDGE_SECRET');
/** Dirección pública de los perfiles de Connexo (para el enlace a la vista previa). */
// OJO: el dominio SIN «www» (connexoapp.com) no resuelve; la app corre en www.connexoapp.com.
const urlPublicaConnexo = () => (Deno.env.get('CONNEXO_PUBLIC_URL') ?? 'https://www.connexoapp.com').replace(/\/+$/, '');

class PuenteSinConfigurar extends Error {
  constructor() {
    super('El puente con Connexo no está configurado (faltan CONNEXO_BRIDGE_URL / CONNEXO_BRIDGE_SECRET).');
  }
}

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

async function llamarPuente(body: Json): Promise<Json> {
  const url = Deno.env.get('CONNEXO_BRIDGE_URL');
  const secret = Deno.env.get('CONNEXO_BRIDGE_SECRET');
  if (!url || !secret) throw new PuenteSinConfigurar();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-koda-secret': secret },
      body: JSON.stringify({ v: VERSION_CONTRATO, ...body }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({} as Json));
    if (!res.ok) throw new Error(data?.error ?? `Connexo respondió ${res.status}.`);
    return data;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('Connexo tardó demasiado en responder.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Ejecuta `fn` sobre cada elemento con a lo sumo `n` en vuelo a la vez. */
async function enParalelo<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}

const soloDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/** Celular de Ecuador en E.164 (+5939XXXXXXXX) desde cualquier formato habitual, o null (fijos, extranjeros, basura). */
function celularEC(raw: string | null | undefined): string | null {
  let d = soloDigitos(raw);
  if (d.startsWith('00')) d = d.slice(2);
  if (/^09\d{8}$/.test(d)) d = `593${d.slice(1)}`;
  else if (/^9\d{8}$/.test(d)) d = `593${d}`;
  return MOVIL_EC_RE.test(d) ? `+${d}` : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = getAdminClient();

  try {
    const caller: Caller = await requireCaller(req, admin);
    if (caller.isCron || !(caller.esPropietario || caller.permisos.includes('enviar_a_connexo'))) {
      return json({ error: 'No tienes habilitado enviar prospectos a Connexo. Pídeselo al propietario de KODA.' }, 403);
    }
    const body = await req.json().catch(() => ({} as Json));

    // ── Refrescar estados ─────────────────────────────────────────────────
    if (body?.action === 'estado') {
      if (!Deno.env.get('CONNEXO_BRIDGE_URL') || !Deno.env.get('CONNEXO_BRIDGE_SECRET')) {
        return json({ ok: true, configurado: false, actualizados: 0 });
      }
      let q = admin.from('connexo_envios')
        .select('id, prospect_id, estado')
        .not('estado', 'in', `(${ESTADOS_FINALES.join(',')})`)
        .order('enviado_at', { ascending: false })
        .limit(200);
      if (!caller.esPropietario) q = q.eq('owner_id', caller.id);
      const { data: filas, error: fErr } = await q;
      if (fErr) return json({ error: fErr.message }, 500);
      if (!filas?.length) return json({ ok: true, configurado: true, actualizados: 0 });

      const r = await llamarPuente({
        action: 'status',
        items: filas.map((f) => ({ envio_id: f.id, koda_prospect_id: f.prospect_id })),
      });

      let actualizados = 0;
      for (const it of (r.items ?? []) as Json[]) {
        const estado = ESTADOS.has(it.estado) ? it.estado : null;
        if (!it.envio_id || !estado) continue;
        const { error: uErr } = await admin.from('connexo_envios').update({
          estado,
          detalle: it.detalle ?? null,
          connexo_profile_id: it.profile_id ?? null,
          connexo_username: it.username ?? null,
          connexo_theme: it.theme ?? null,
          actualizado_at: new Date().toISOString(),
        }).eq('id', it.envio_id);
        if (!uErr) actualizados++;
        // Si el negocio pidió no recibir más mensajes, KODA lo respeta en toda su base.
        if (it.opt_out === true && it.koda_prospect_id) {
          await admin.from('prospects').update({ opt_out: true }).eq('id', it.koda_prospect_id);
        }
      }
      return json({ ok: true, configurado: true, actualizados });
    }

    // ── Enviar prospectos a Connexo ───────────────────────────────────────
    if (body?.action === 'enviar') {
      const pedidos: unknown[] = Array.isArray(body.prospect_ids) ? body.prospect_ids : [];
      const ids: string[] = [...new Set(
        pedidos.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)),
      )];
      if (!ids.length) return json({ error: 'No elegiste ningún prospecto.' }, 400);
      if (ids.length > MAX_POR_LLAMADA) return json({ error: `Envía como máximo ${MAX_POR_LLAMADA} prospectos por vez.` }, 400);
      if (!Deno.env.get('CONNEXO_BRIDGE_URL') || !Deno.env.get('CONNEXO_BRIDGE_SECRET')) {
        return json({ error: new PuenteSinConfigurar().message }, 503);
      }

      const [prospectosR, contactosR, corridasR, existentesR] = await Promise.all([
        admin.from('prospects')
          .select('id, owner_id, nombre, categoria, descripcion, direccion, ciudad, provincia, pais, lat, lng, website, instagram, facebook, tiktok, whatsapp, google_maps_url, rating, reviews_count, opt_out, anonimizado')
          .in('id', ids),
        admin.from('prospect_contacts').select('prospect_id, tipo, valor').in('prospect_id', ids).in('tipo', ['email', 'telefono']),
        admin.from('prospect_runs').select('prospect_id, job_id, found_at').in('prospect_id', ids).order('found_at', { ascending: false }),
        admin.from('connexo_envios').select('id, prospect_id, estado').in('prospect_id', ids),
      ]);
      if (prospectosR.error) return json({ error: prospectosR.error.message }, 500);

      const contactos = new Map<string, { email?: string; telefono?: string }>();
      for (const c of contactosR.data ?? []) {
        const e = contactos.get(c.prospect_id) ?? {};
        if (c.tipo === 'email' && !e.email) e.email = String(c.valor).trim().toLowerCase();
        if (c.tipo === 'telefono' && !e.telefono) e.telefono = String(c.valor);
        contactos.set(c.prospect_id, e);
      }
      const jobDe = new Map<string, string>();   // prospecto → búsqueda más reciente
      for (const c of corridasR.data ?? []) if (c.job_id && !jobDe.has(c.prospect_id)) jobDe.set(c.prospect_id, c.job_id);
      const jobIds = [...new Set(jobDe.values())];
      const { data: jobs } = jobIds.length
        ? await admin.from('search_jobs').select('id, nombre').in('id', jobIds)
        : { data: [] as { id: string; nombre: string }[] };
      const nombreJob = new Map((jobs ?? []).map((j) => [j.id, j.nombre as string]));
      const existentes = new Map((existentesR.data ?? []).map((e) => [e.prospect_id as string, e]));

      const ownerIds = [...new Set((prospectosR.data ?? []).map((p) => p.owner_id as string))];
      const { data: duenos } = await admin.from('profiles').select('id, email, nombre').in('id', ownerIds);
      const dueno = new Map((duenos ?? []).map((d) => [d.id as string, d]));

      const resultados: Json[] = [];
      const aEnviar: Json[] = [];
      const hallados = new Set<string>();

      for (const p of prospectosR.data ?? []) {
        hallados.add(p.id);
        const base = { prospect_id: p.id, nombre: p.nombre };
        // El aislamiento lo aplicamos a mano porque esta función usa service_role.
        if (!caller.esPropietario && p.owner_id !== caller.id) {
          resultados.push({ ...base, resultado: 'omitido', motivo: 'No es tuyo.' });
          continue;
        }
        if (p.opt_out) { resultados.push({ ...base, resultado: 'omitido', motivo: 'Pidió no ser contactado.' }); continue; }
        if (p.anonimizado) { resultados.push({ ...base, resultado: 'omitido', motivo: 'Datos anonimizados.' }); continue; }
        const ex = existentes.get(p.id);
        if (ex && ex.estado !== 'error') {
          resultados.push({ ...base, resultado: 'omitido', motivo: 'Ya fue enviado a Connexo.', estado: ex.estado });
          continue;
        }
        if (!celularEC(p.whatsapp)) {
          resultados.push({ ...base, resultado: 'omitido', motivo: 'No tiene un celular con WhatsApp (los fijos no reciben).' });
          continue;
        }
        aEnviar.push(p);
      }
      for (const id of ids) if (!hallados.has(id)) resultados.push({ prospect_id: id, resultado: 'omitido', motivo: 'No existe.' });

      await enParalelo(aEnviar, CONCURRENCIA, async (p) => {
        const c = contactos.get(p.id) ?? {};
        const jobId = jobDe.get(p.id) ?? null;
        const busqueda = jobId ? (nombreJob.get(jobId) ?? null) : null;
        const rubro = rubroDe(p.categoria);
        const d = dueno.get(p.owner_id);
        const ahora = new Date().toISOString();

        // 1) Se registra ANTES de llamar: si la función se corta, el envío no se pierde ni se duplica.
        const fila = {
          owner_id: p.owner_id, prospect_id: p.id, prospect_nombre: p.nombre, prospect_ciudad: p.ciudad,
          categoria: p.categoria, rubro, job_id: jobId, busqueda_nombre: busqueda, estado: 'pendiente',
          detalle: null, enviado_por: caller.id, enviado_at: ahora, actualizado_at: ahora,
        };
        const ex = existentes.get(p.id);
        let envioId: string;
        if (ex) {
          const { error } = await admin.from('connexo_envios').update(fila).eq('id', ex.id);
          if (error) { resultados.push({ prospect_id: p.id, nombre: p.nombre, resultado: 'error', motivo: error.message }); return; }
          envioId = ex.id;
        } else {
          const { data, error } = await admin.from('connexo_envios').insert(fila).select('id').single();
          if (error || !data) { resultados.push({ prospect_id: p.id, nombre: p.nombre, resultado: 'error', motivo: error?.message ?? 'No se pudo registrar.' }); return; }
          envioId = data.id;
        }

        // 2) Se pide el borrador a Connexo.
        try {
          const r = await llamarPuente({
            action: 'upsert',
            koda: {
              envio_id: envioId,
              prospect_id: p.id,
              owner_email: d?.email ?? null,
              owner_nombre: d?.nombre ?? null,
              busqueda: busqueda ? { job_id: jobId, nombre: busqueda } : null,
            },
            negocio: {
              nombre: p.nombre,
              categoria: p.categoria,
              rubro,
              descripcion: p.descripcion,
              direccion: p.direccion,
              ciudad: p.ciudad,
              provincia: p.provincia,
              pais: p.pais ?? 'EC',
              lat: p.lat,
              lng: p.lng,
              telefono: c.telefono ?? null,
              whatsapp: celularEC(p.whatsapp),
              email: c.email ?? null,
              website: p.website,
              instagram: p.instagram,
              facebook: p.facebook,
              tiktok: p.tiktok,
              google_maps_url: p.google_maps_url,
              rating: p.rating,
              reviews_count: p.reviews_count,
            },
          });
          const estado = ESTADOS.has(r.estado) ? r.estado : 'borrador';
          await admin.from('connexo_envios').update({
            estado,
            detalle: r.detalle ?? null,
            connexo_profile_id: r.profile_id ?? null,
            connexo_username: r.username ?? null,
            connexo_theme: r.theme ?? null,
            actualizado_at: new Date().toISOString(),
          }).eq('id', envioId);
          resultados.push({ prospect_id: p.id, nombre: p.nombre, resultado: 'enviado', estado, username: r.username ?? null, theme: r.theme ?? null });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await admin.from('connexo_envios').update({ estado: 'error', detalle: msg, actualizado_at: new Date().toISOString() }).eq('id', envioId);
          resultados.push({ prospect_id: p.id, nombre: p.nombre, resultado: 'error', motivo: msg });
        }
      });

      const enviados = resultados.filter((r) => r.resultado === 'enviado').length;
      await admin.from('audit_log').insert({
        actor_id: caller.id,
        accion: 'connexo_enviar',
        entidad: 'connexo_envios',
        despues: {
          pedidos: ids.length,
          enviados,
          omitidos: resultados.filter((r) => r.resultado === 'omitido').length,
          errores: resultados.filter((r) => r.resultado === 'error').length,
        },
      });
      return json({ ok: true, enviados, resultados });
    }

    // ── Revisión: aprobar, devolver, descartar, restaurar o rehacer el relleno ──
    if (body?.action === 'revision') {
      const paso = PASOS_REVISION[String(body.paso)];
      if (!paso) return json({ error: 'Paso de revisión desconocido.' }, 400);
      const pedidos: unknown[] = Array.isArray(body.envio_ids) ? body.envio_ids : [body.envio_id];
      const ids: string[] = [...new Set(pedidos.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))];
      if (!ids.length) return json({ error: 'No elegiste ningún negocio.' }, 400);
      if (ids.length > MAX_POR_LLAMADA) return json({ error: `Elige como máximo ${MAX_POR_LLAMADA} negocios por vez.` }, 400);
      if (!puenteConfigurado()) return json({ error: new PuenteSinConfigurar().message }, 503);

      let q = admin.from('connexo_envios').select('id, prospect_nombre, estado').in('id', ids);
      if (!caller.esPropietario) q = q.eq('owner_id', caller.id);
      const { data: filas, error: fErr } = await q;
      if (fErr) return json({ error: fErr.message }, 500);
      const porId = new Map((filas ?? []).map((f) => [f.id as string, f]));

      const resultados = await enParalelo(ids, CONCURRENCIA, async (id) => {
        const f = porId.get(id);
        if (!f) return { id, ok: false, error: 'No lo encontré entre tus envíos.' };
        try {
          const r = await llamarPuente({ action: paso.puente, envio_id: id, ...(paso.estado ? { estado: paso.estado } : {}) });
          const estado = ESTADOS.has(r.estado) ? r.estado : f.estado;
          await admin.from('connexo_envios').update({ estado, detalle: r.detalle ?? null, actualizado_at: new Date().toISOString() }).eq('id', id);
          return { id, nombre: f.prospect_nombre, ok: paso.puente === 'rellenar' ? r.relleno_ok !== false : true, estado, error: r.relleno_ok === false ? (r.detalle ?? 'El relleno quedó incompleto.') : undefined };
        } catch (e) {
          return { id, nombre: f.prospect_nombre, ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      });

      await admin.from('audit_log').insert({
        usuario_id: caller.id,
        accion: `connexo_${String(body.paso)}`,
        entidad: 'connexo_envios',
        despues: { pedidos: ids.length, ok: resultados.filter((r) => r.ok).length, errores: resultados.filter((r) => !r.ok).length },
      });
      return json({ ok: true, resultados });
    }

    // ── Detalle de un envío: qué se llenó, de dónde salió cada dato y el enlace a la vista previa ──
    if (body?.action === 'detalle') {
      const id = body.envio_id;
      if (typeof id !== 'string' || !UUID_RE.test(id)) return json({ error: 'envio_id inválido.' }, 400);
      if (!puenteConfigurado()) return json({ error: new PuenteSinConfigurar().message }, 503);
      let q = admin.from('connexo_envios').select('id, estado').eq('id', id);
      if (!caller.esPropietario) q = q.eq('owner_id', caller.id);
      const { data: fila, error: fErr } = await q.maybeSingle();
      if (fErr) return json({ error: fErr.message }, 500);
      if (!fila) return json({ error: 'No lo encontré entre tus envíos.' }, 404);

      const r = await llamarPuente({ action: 'detalle', envio_id: id });
      if (ESTADOS.has(r.estado) && r.estado !== fila.estado) {
        await admin.from('connexo_envios').update({
          estado: r.estado, detalle: r.detalle ?? null, connexo_username: r.username ?? null, actualizado_at: new Date().toISOString(),
        }).eq('id', id);
      }
      return json({
        ok: true,
        estado: r.estado,
        detalle: r.detalle ?? null,
        username: r.username ?? null,
        theme: r.theme ?? null,
        clave: r.clave ?? null,
        relleno: r.relleno ?? null,
        preview_url: r.username ? `${urlPublicaConnexo()}/${encodeURIComponent(r.username)}` : null,
      });
    }

    return json({ error: 'Acción desconocida.' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const noAuth = /No autorizado/.test(msg);
    return json({ error: msg }, noAuth ? 401 : e instanceof PuenteSinConfigurar ? 503 : 500);
  }
});
