// koda-connexo: puente KODA → Connexo Clients.
//
// KODA y Connexo son proyectos Supabase distintos. Esta función es el ÚNICO lugar de KODA que
// habla con Connexo, y lo hace con un secreto compartido (`x-koda-secret`) contra la función
// `kodaIntake` de Connexo: KODA nunca guarda la service_role de Connexo.
//
// Quién puede usarla: SOLO la cuenta propietaria (connexoec). No hay permiso para delegarlo
// (ver can_send_connexo() en 0013). No la llama el cron.
//
// Acciones:
//   { action: 'enviar', prospect_ids, lote?, dry_run? } → arma el borrador de cada prospecto en Connexo, dentro de un LOTE
//        (lote: {id} para seguir llenando uno existente, {nombre?} para abrir uno nuevo). Con dry_run:true NO envía nada:
//        dice cuáles saldrían y por qué se omite el resto (vista previa del lote).
//   { action: 'estado' }                          → refresca el estado de los envíos desde Connexo (y le avisa de los lotes nuevos)
//   { action: 'lote_renombrar', lote_id, nombre } → cambia el nombre del lote (Connexo lo recibe al instante o en el próximo refresco)
//   { action: 'revision', envio_ids, paso }       → aprobar | devolver | descartar | restaurar | rellenar
//   { action: 'detalle', envio_id }               → qué se llenó, de dónde salió cada dato y el enlace de vista previa
//   { action: 'whatsapp_cupo' }                   → cuántos WhatsApp quedan hoy (ventana de 24 h)
//   { action: 'whatsapp_enviar', envio_ids }      → manda el saludo inicial por WhatsApp a los APROBADOS (lo envía Connexo)
//   { action: 'wa_responder', conversacion_id, texto, client_id, reintentar_id?, responde_a?, forzar? }
//                                                  → BANDEJA: responde con texto libre dentro de la ventana de 24 h (migración 0016)
//   { action: 'wa_media', mensaje_id }            → BANDEJA: baja y guarda el archivo de un mensaje que aún no se guardó
//   { action: 'wa_importar_saludos' }             → BANDEJA: trae los saludos que Connexo ya había enviado, para que los chats los muestren
//   { action: 'agente_estado' }                   → AGENTE (0017/0018): ¿está la clave de Anthropic?, la configuración (modo, motor) y el tamaño del banco
//   { action: 'agente_generar', conversacion_id } → AGENTE: «otra versión» del borrador de ese chat
//   { action: 'agente_probar', mensaje, theme?, nombre?, estado?, historial?, motor? } → AGENTE: redacta una respuesta de prueba (no guarda ni envía nada)
//   { action: 'agente_banco_sembrar' }            → AGENTE (0018): sube las respuestas de fábrica al banco (idempotente: no pisa lo editado ni lo aprendido)
//   (wa_responder acepta además `borrador_id`: el agente aprende de lo que envías, lo uses tal cual, lo edites o escribas otra cosa;
//    lo que no estaba en el banco vuelve a él como variante, frase o entrada nueva)
//
// Opcional: CONNEXO_PUBLIC_URL (por defecto https://www.connexoapp.com) para armar el enlace a la vista previa.
//
// Secrets de esta función (supabase secrets set):
//   CONNEXO_BRIDGE_URL     https://<ref-de-connexo>.supabase.co/functions/v1/kodaIntake
//   CONNEXO_BRIDGE_SECRET  el mismo valor que KODA_BRIDGE_SECRET en las funciones de Connexo
//   CONNEXO_WA_URL         (opcional) …/functions/v1/kodaWhatsApp; si falta se deduce de CONNEXO_BRIDGE_URL
import { corsHeaders, json } from '../_shared/cors.ts';
import { getAdminClient, requireCaller, type Caller } from '../_shared/supabaseAdmin.ts';
import { rubroDe } from '../_shared/rubros.ts';
import {
  celularEC, ESTADOS_CONTACTADOS, evaluarEnvio, saludoYaEnviado, type EnvioRegistrado,
} from '../_shared/connexoEnvio.ts';
import { guardarArchivo, registrarRespuestasPasadas, registrarSaludos, type BandejaDb } from '../_shared/waBandeja.ts';
import { responderDesdeBandeja } from '../_shared/waResponder.ts';
import { llamarWa } from '../_shared/connexoWa.ts';
import { crearDepsAgente } from '../_shared/agenteDeps.ts';
import { claveAnthropicConfigurada, SinClaveAnthropic } from '../_shared/agenteModelo.ts';
import {
  cargarBanco, decidirSinModelo, esAutorrespuesta, generarConMotor, procesarConversacion, revisarRespuesta,
  type ContextoAgente, type EjemploCtx, type Motor,
} from '../_shared/waAgente.ts';
import { planearAprendizaje } from '../_shared/waRecuerdo.ts';
import { SEMILLAS } from '../_shared/bancoSemilla.ts';

const VERSION_CONTRATO = 1;
const MAX_POR_LLAMADA = 50;
// La vista previa del lote no llama a Connexo, así que admite una selección grande de una vez; las consultas a la
// base se parten en trozos para no armar direcciones kilométricas.
const MAX_VISTA_PREVIA = 200;
const TROZO_CONSULTA = 50;
// «enviar» y «revision» hacen UNA llamada a Connexo por negocio dentro de la misma ejecución, y Supabase corta con
// «Rate limit exceeded for trace» pasadas ~30 llamadas encadenadas (se vio con 50: 30 salieron y 20 fallaron).
// La pantalla manda en tandas de 25; el WhatsApp es una sola llamada y admite 50.
const MAX_TANDA_PUENTE = 25;
const CONCURRENCIA = 3;
const TIMEOUT_MS = 30_000;
// Enviar hasta 50 WhatsApp toma más (Meta responde ~0,5 s por mensaje, 3 en paralelo).
const TIMEOUT_WA_MS = 120_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Lo que devuelve `wa_agente_aprender` (0018): con esto se decide qué guardar en el banco de respuestas. */
interface DatosAprendizaje {
  aprendido?: boolean; duplicado?: boolean; origen?: 'aprobado' | 'editado' | 'directo'; banco_id?: string | null;
  contexto?: { d: 'cliente' | 'nosotros'; t: string }[]; nombre_perfil?: string | null; negocio?: string | null;
}

/**
 * Lo que el propietario envió vuelve al banco: como variante de la entrada que ya existía, como frase nueva, o como entrada nueva.
 * Los controles (`planearAprendizaje`) dejan fuera lo particular de un chat (entregas de claves, teléfonos, precios inventados…).
 */
async function aprenderEnBanco(db: BandejaDb, d: DatosAprendizaje, texto: string): Promise<void> {
  if (!d.origen) return;
  const banco = await cargarBanco(db);
  const plan = planearAprendizaje({
    origen: d.origen, textoHumano: texto, contexto: d.contexto ?? [], bancoIdBorrador: d.banco_id ?? null, banco,
    nombrePerfil: d.nombre_perfil ?? null, negocio: d.negocio ?? null, revisar: revisarRespuesta, esBot: esAutorrespuesta,
  });
  if (plan.accion === 'ninguna') return;
  const r = await db.rpc('wa_agente_banco_aprender', {
    p: { banco_id: plan.banco_id ?? null, disparador: plan.disparador ?? null, variante: plan.variante ?? null, titulo: plan.titulo ?? null, intencion: plan.intencion ?? null },
  });
  if (r.error) throw new Error(`wa_agente_banco_aprender: ${r.error.message}`);
}

const MOTORES = new Set(['recuerdo', 'claude', 'mixto']);

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

type Destino = 'intake' | 'whatsapp';

/** Dirección de cada función de Connexo. El WhatsApp vive en `kodaWhatsApp`, al lado de `kodaIntake`. */
function urlDestino(destino: Destino): string | null {
  const base = Deno.env.get('CONNEXO_BRIDGE_URL');
  if (destino === 'intake') return base ?? null;
  const explicita = Deno.env.get('CONNEXO_WA_URL');
  if (explicita) return explicita;
  if (!base) return null;
  const deducida = base.replace(/\/kodaIntake\/?$/, '/kodaWhatsApp');
  return deducida === base ? null : deducida;     // no termina en /kodaIntake: hay que decir la dirección a mano
}

async function llamarPuente(body: Json, destino: Destino = 'intake'): Promise<Json> {
  const url = urlDestino(destino);
  const secret = Deno.env.get('CONNEXO_BRIDGE_SECRET');
  if (!url || !secret) throw new PuenteSinConfigurar();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), destino === 'whatsapp' ? TIMEOUT_WA_MS : TIMEOUT_MS);
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

const trozos = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/** Corre una consulta `.in(...)` por trozos de ids y junta las filas (una selección grande no cabe en una dirección). */
async function porTrozos<R>(
  ids: string[],
  consulta: (trozo: string[]) => PromiseLike<{ data: R[] | null; error: { message: string } | null }>,
): Promise<R[]> {
  const out: R[] = [];
  for (const t of trozos(ids, TROZO_CONSULTA)) {
    const { data, error } = await consulta(t);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
  }
  return out;
}

interface Lote { id: string; numero: number; nombre: string | null }

/**
 * Le avisa a Connexo el número y el nombre de los lotes que aún no conoce (nuevos o renombrados). Si Connexo no
 * responde, el lote queda por sincronizar y se reintenta en el próximo refresco: nunca estorba a quien llama.
 */
async function sincronizarLotes(admin: ReturnType<typeof getAdminClient>, ownerId: string): Promise<void> {
  const { data: lotes } = await admin.from('connexo_lotes')
    .select('id, numero, nombre, actualizado_at')
    .eq('owner_id', ownerId).is('sincronizado_at', null).order('numero').limit(10);
  for (const l of lotes ?? []) {
    try {
      const { data: envios } = await admin.from('connexo_envios').select('id').eq('lote_id', l.id).limit(1000);
      for (const t of trozos((envios ?? []).map((e) => e.id as string), 200)) {
        await llamarPuente({ action: 'lote_set', lote: { id: l.id, numero: l.numero, nombre: l.nombre }, envio_ids: t });
      }
      // Si lo renombraron mientras tanto, no se da por sincronizado.
      await admin.from('connexo_lotes').update({ sincronizado_at: new Date().toISOString() })
        .eq('id', l.id).eq('actualizado_at', l.actualizado_at);
    } catch (e) {
      console.error('[koda-connexo] lote sin sincronizar:', l.id, e instanceof Error ? e.message : e);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = getAdminClient();

  try {
    const caller: Caller = await requireCaller(req, admin);
    if (caller.isCron || !caller.esPropietario) {
      return json({ error: 'Esta función es solo de la cuenta propietaria de KODA.' }, 403);
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
      let actualizados = 0;
      if (filas?.length) {
        const r = await llamarPuente({
          action: 'status',
          items: filas.map((f) => ({ envio_id: f.id, koda_prospect_id: f.prospect_id })),
        });

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
      }
      // Los lotes nuevos o renombrados le llegan a Connexo aquí (cada vez que se abre la pantalla de Connexo).
      await sincronizarLotes(admin, caller.id);
      return json({ ok: true, configurado: true, actualizados });
    }

    // ── Renombrar un lote ─────────────────────────────────────────────────
    if (body?.action === 'lote_renombrar') {
      const id = body.lote_id;
      if (typeof id !== 'string' || !UUID_RE.test(id)) return json({ error: 'lote_id inválido.' }, 400);
      const nombre = typeof body.nombre === 'string' ? body.nombre.trim().slice(0, 80) : '';
      const ahora = new Date().toISOString();
      const { data: lote, error: lErr } = await admin.from('connexo_lotes')
        .update({ nombre: nombre || null, actualizado_at: ahora, sincronizado_at: null })
        .eq('id', id).eq('owner_id', caller.id).select('id, numero, nombre').maybeSingle();
      if (lErr) return json({ error: lErr.message }, 500);
      if (!lote) return json({ error: 'No encontré ese lote.' }, 404);
      if (puenteConfigurado()) await sincronizarLotes(admin, caller.id);
      return json({ ok: true, lote });
    }

    // ── Enviar prospectos a Connexo ───────────────────────────────────────
    if (body?.action === 'enviar') {
      const vistaPrevia = body.dry_run === true;
      const pedidos: unknown[] = Array.isArray(body.prospect_ids) ? body.prospect_ids : [];
      const ids: string[] = [...new Set(
        pedidos.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)),
      )];
      if (!ids.length) return json({ error: 'No elegiste ningún prospecto.' }, 400);
      const tope = vistaPrevia ? MAX_VISTA_PREVIA : MAX_TANDA_PUENTE;
      if (ids.length > tope) return json({ error: `Envía como máximo ${tope} prospectos por vez.` }, 400);
      if (!vistaPrevia && !puenteConfigurado()) return json({ error: new PuenteSinConfigurar().message }, 503);

      const [prospectosD, contactosD, corridasD, existentesD] = await Promise.all([
        porTrozos(ids, (t) => admin.from('prospects')
          .select('id, owner_id, nombre, categoria, descripcion, direccion, ciudad, provincia, pais, lat, lng, website, instagram, facebook, tiktok, whatsapp, google_maps_url, rating, reviews_count, opt_out, anonimizado, status')
          .in('id', t)),
        porTrozos(ids, (t) => admin.from('prospect_contacts').select('prospect_id, tipo, valor').in('prospect_id', t).in('tipo', ['email', 'telefono'])),
        porTrozos(ids, (t) => admin.from('prospect_runs').select('prospect_id, job_id, found_at').in('prospect_id', t).order('found_at', { ascending: false })),
        porTrozos(ids, (t) => admin.from('connexo_envios').select('id, prospect_id, prospect_nombre, estado, whatsapp').in('prospect_id', t)),
      ]);

      const contactos = new Map<string, { email?: string; telefono?: string }>();
      for (const c of contactosD) {
        const e = contactos.get(c.prospect_id) ?? {};
        if (c.tipo === 'email' && !e.email) e.email = String(c.valor).trim().toLowerCase();
        if (c.tipo === 'telefono' && !e.telefono) e.telefono = String(c.valor);
        contactos.set(c.prospect_id, e);
      }
      const jobDe = new Map<string, string>();   // prospecto → búsqueda más reciente
      for (const c of [...corridasD].sort((a, b) => String(b.found_at).localeCompare(String(a.found_at)))) {
        if (c.job_id && !jobDe.has(c.prospect_id)) jobDe.set(c.prospect_id, c.job_id);
      }
      const jobIds = [...new Set(jobDe.values())];
      const jobs = jobIds.length ? await porTrozos(jobIds, (t) => admin.from('search_jobs').select('id, nombre').in('id', t)) : [];
      const nombreJob = new Map(jobs.map((j) => [j.id as string, j.nombre as string]));
      const existentes = new Map(existentesD.map((e) => [e.prospect_id as string, e as EnvioRegistrado]));

      // Libro de celulares: TODO envío registrado con el celular de cualquiera de estos prospectos (aunque sea de
      // otro prospecto o de uno ya borrado). Así el mismo negocio no recibe el saludo dos veces.
      const celulares = [...new Set(prospectosD.map((p) => celularEC(p.whatsapp)).filter((x): x is string => !!x))];
      const libro = celulares.length
        ? await porTrozos(celulares, (t) => admin.from('connexo_envios').select('id, prospect_id, prospect_nombre, estado, whatsapp').in('whatsapp', t))
        : [];
      const porCelular = new Map<string, EnvioRegistrado[]>();
      for (const e of libro as EnvioRegistrado[]) {
        if (!e.whatsapp) continue;
        porCelular.set(e.whatsapp, [...(porCelular.get(e.whatsapp) ?? []), e]);
      }

      const ownerIds = [...new Set(prospectosD.map((p) => p.owner_id as string))];
      const duenos = ownerIds.length ? await porTrozos(ownerIds, (t) => admin.from('profiles').select('id, email, nombre').in('id', t)) : [];
      const dueno = new Map(duenos.map((d) => [d.id as string, d]));

      const resultados: Json[] = [];
      const aEnviar: Json[] = [];
      const porId = new Map(prospectosD.map((p) => [p.id as string, p]));
      const yaEnLote = new Map<string, string>();   // celular → negocio al que le tocó primero en este envío

      // En el orden en que el propietario los eligió, para que el desempate entre dos con el mismo celular sea predecible.
      for (const id of ids) {
        const p = porId.get(id);
        if (!p) { resultados.push({ prospect_id: id, resultado: 'omitido', codigo: 'no_existe', motivo: 'No existe.' }); continue; }
        const base = { prospect_id: p.id, nombre: p.nombre };
        const rubro = rubroDe(p.categoria, p.nombre);
        const celular = celularEC(p.whatsapp);
        const omision = evaluarEnvio(p, {
          esPropietario: caller.esPropietario,
          callerId: caller.id,
          rubro,
          propio: existentes.get(p.id) ?? null,
          conMismoCelular: celular ? (porCelular.get(celular) ?? []) : [],
          yaEnLote,
        });
        if (omision) { resultados.push({ ...base, resultado: 'omitido', ...omision }); continue; }
        if (celular) yaEnLote.set(celular, p.nombre);
        aEnviar.push(p);
        if (vistaPrevia) resultados.push({ ...base, resultado: 'listo', rubro, categoria: p.categoria ?? null, ciudad: p.ciudad ?? null });
      }

      if (vistaPrevia) return json({ ok: true, vista_previa: true, listos: aEnviar.length, resultados });

      // Todo envío vive dentro de un lote: el que se está llenando (varias tandas seguidas) o uno nuevo.
      let lote: Lote | null = null;
      if (aEnviar.length) {
        const pedido: Json = (body.lote && typeof body.lote === 'object') ? body.lote : {};
        if (typeof pedido.id === 'string' && UUID_RE.test(pedido.id)) {
          const { data } = await admin.from('connexo_lotes').select('id, numero, nombre').eq('id', pedido.id).eq('owner_id', caller.id).maybeSingle();
          if (!data) return json({ error: 'Ese lote no existe.' }, 404);
          lote = data as Lote;
        } else {
          const { data, error } = await admin.rpc('connexo_nuevo_lote', {
            p_owner: caller.id, p_nombre: typeof pedido.nombre === 'string' ? pedido.nombre : null, p_usuario: caller.id,
          });
          if (error || !data) return json({ error: error?.message ?? 'No se pudo crear el lote.' }, 500);
          lote = data as Lote;
        }
      }

      await enParalelo(aEnviar, CONCURRENCIA, async (p) => {
        const c = contactos.get(p.id) ?? {};
        const jobId = jobDe.get(p.id) ?? null;
        const busqueda = jobId ? (nombreJob.get(jobId) ?? null) : null;
        const rubro = rubroDe(p.categoria, p.nombre);
        const d = dueno.get(p.owner_id);
        const ahora = new Date().toISOString();

        // 1) Se registra ANTES de llamar: si la función se corta, el envío no se pierde ni se duplica.
        //    Con el celular y el lote: el celular queda en el libro aunque luego se borre el prospecto.
        const fila = {
          owner_id: p.owner_id, prospect_id: p.id, prospect_nombre: p.nombre, prospect_ciudad: p.ciudad,
          categoria: p.categoria, rubro, job_id: jobId, busqueda_nombre: busqueda, estado: 'pendiente',
          detalle: null, enviado_por: caller.id, enviado_at: ahora, actualizado_at: ahora,
          whatsapp: celularEC(p.whatsapp), lote_id: lote?.id ?? null,
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
              lote: lote ? { id: lote.id, numero: lote.numero, nombre: lote.nombre } : null,
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
          // Connexo también vigila los celulares repetidos: si lo descartó por eso, aquí NO cuenta como enviado.
          if (estado === 'descartado') {
            resultados.push({ prospect_id: p.id, nombre: p.nombre, resultado: 'omitido', codigo: 'celular_repetido', motivo: r.detalle ?? 'Connexo lo descartó.', estado });
          } else {
            resultados.push({ prospect_id: p.id, nombre: p.nombre, resultado: 'enviado', estado, username: r.username ?? null, theme: r.theme ?? null });
          }
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
          lote: lote ? lote.numero : null,
        },
      });
      return json({ ok: true, enviados, resultados, lote });
    }

    // ── Revisión: aprobar, devolver, descartar, restaurar o rehacer el relleno ──
    if (body?.action === 'revision') {
      const paso = PASOS_REVISION[String(body.paso)];
      if (!paso) return json({ error: 'Paso de revisión desconocido.' }, 400);
      const pedidos: unknown[] = Array.isArray(body.envio_ids) ? body.envio_ids : [body.envio_id];
      const ids: string[] = [...new Set(pedidos.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))];
      if (!ids.length) return json({ error: 'No elegiste ningún negocio.' }, 400);
      if (ids.length > MAX_TANDA_PUENTE) return json({ error: `Elige como máximo ${MAX_TANDA_PUENTE} negocios por vez.` }, 400);
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
        actor_id: caller.id,
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

    // ── WhatsApp: cupo del día ────────────────────────────────────────────
    if (body?.action === 'whatsapp_cupo') {
      if (!puenteConfigurado()) return json({ ok: true, configurado: false });
      const r = await llamarPuente({ action: 'cupo' }, 'whatsapp');
      return json({
        ok: true,
        configurado: r.configurado !== false,
        limite: r.limite ?? null,
        usados: r.usados ?? null,
        disponibles: r.disponibles ?? null,
      });
    }

    // ── WhatsApp: mandar el saludo inicial a los APROBADOS ────────────────
    if (body?.action === 'whatsapp_enviar') {
      const pedidos: unknown[] = Array.isArray(body.envio_ids) ? body.envio_ids : [];
      const ids: string[] = [...new Set(pedidos.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))];
      if (!ids.length) return json({ error: 'No elegiste ningún negocio.' }, 400);
      if (ids.length > MAX_POR_LLAMADA) return json({ error: `Elige como máximo ${MAX_POR_LLAMADA} negocios por vez.` }, 400);
      if (!puenteConfigurado()) return json({ error: new PuenteSinConfigurar().message }, 503);

      let q = admin.from('connexo_envios').select('id, prospect_id, prospect_nombre, estado, whatsapp').in('id', ids);
      if (!caller.esPropietario) q = q.eq('owner_id', caller.id);
      const { data: filas, error: fErr } = await q;
      if (fErr) return json({ error: fErr.message }, 500);
      const porId = new Map((filas ?? []).map((f) => [f.id as string, f]));

      // Libro de celulares: quién más, con el mismo celular, ya recibió (o está recibiendo) el saludo.
      const celulares = [...new Set((filas ?? []).filter((f) => f.estado === 'aprobado').map((f) => f.whatsapp as string | null).filter((x): x is string => !!x))];
      const contactados = celulares.length
        ? await porTrozos(celulares, (t) => admin.from('connexo_envios')
            .select('id, prospect_id, prospect_nombre, estado, whatsapp').in('whatsapp', t).in('estado', ESTADOS_CONTACTADOS))
        : [];

      // Solo los APROBADOS salen (Connexo lo vuelve a comprobar). El resto se explica, no se manda.
      const resultados: Json[] = [];
      const aEnviar: string[] = [];
      const yaEnTanda = new Map<string, string>();   // celular → negocio al que le toca en esta tanda
      for (const id of ids) {
        const f = porId.get(id);
        if (!f) { resultados.push({ id, resultado: 'omitido', motivo: 'No lo encontré entre tus envíos.' }); continue; }
        if (f.estado !== 'aprobado') {
          resultados.push({ id, nombre: f.prospect_nombre, resultado: 'omitido', motivo: `Está en «${f.estado}»: primero apruébalo.` });
          continue;
        }
        const otro = saludoYaEnviado(f, contactados as EnvioRegistrado[]);
        if (otro) {
          resultados.push({ id, nombre: f.prospect_nombre, resultado: 'omitido', motivo: `Ese celular ya recibió el saludo (como «${otro.prospect_nombre}»): no se le escribe dos veces.` });
          continue;
        }
        const gemelo = f.whatsapp ? yaEnTanda.get(f.whatsapp) : undefined;
        if (gemelo) {
          resultados.push({ id, nombre: f.prospect_nombre, resultado: 'omitido', motivo: `Tiene el mismo celular que «${gemelo}», que sale en esta misma tanda.` });
          continue;
        }
        if (f.whatsapp) yaEnTanda.set(f.whatsapp, f.prospect_nombre);
        aEnviar.push(id);
      }

      let cupo: Json | null = null;
      if (aEnviar.length) {
        const r = await llamarPuente({ action: 'enviar', envio_ids: aEnviar }, 'whatsapp');
        cupo = (r.cupo as Json) ?? null;
        for (const it of (r.resultados ?? []) as Json[]) {
          const id = it.envio_id as string;
          const nombre = porId.get(id)?.prospect_nombre;
          if (it.resultado === 'enviado') {
            await admin.from('connexo_envios')
              .update({ estado: 'wa_enviado', detalle: null, actualizado_at: new Date().toISOString() }).eq('id', id);
            resultados.push({ id, nombre, resultado: 'enviado' });
          } else {
            // No salió: sigue «aprobado» y queda el motivo a la vista (se ve en la tabla).
            if (it.resultado === 'error' && it.motivo) {
              await admin.from('connexo_envios')
                .update({ detalle: `WhatsApp no salió: ${it.motivo}`, actualizado_at: new Date().toISOString() }).eq('id', id);
            }
            resultados.push({ id, nombre, resultado: it.resultado, motivo: it.motivo });
          }
        }
      }

      const enviados = resultados.filter((r) => r.resultado === 'enviado').length;
      await admin.from('audit_log').insert({
        actor_id: caller.id,
        accion: 'connexo_whatsapp_enviar',
        entidad: 'connexo_envios',
        despues: {
          pedidos: ids.length,
          enviados,
          omitidos: resultados.filter((r) => r.resultado === 'omitido').length,
          errores: resultados.filter((r) => r.resultado === 'error').length,
        },
      });
      return json({ ok: true, enviados, resultados, cupo });
    }

    // ── BANDEJA: responder con texto libre (ventana de 24 h) ──────────────
    if (body?.action === 'wa_responder') {
      const conv = body.conversacion_id;
      if (typeof conv !== 'string' || !UUID_RE.test(conv)) return json({ error: 'conversacion_id inválido.' }, 400);
      const tipo = ['image', 'audio', 'video', 'document'].includes(body.tipo) ? body.tipo : 'text';
      // El pie de un archivo es opcional; un mensaje de texto exige texto.
      if (tipo === 'text' && typeof body.texto !== 'string') return json({ error: 'Escribe un mensaje.' }, 400);
      if (typeof body.client_id !== 'string') return json({ error: 'Falta el identificador del envío.' }, 400);
      const m = body.media && typeof body.media === 'object' ? body.media : null;
      const media = tipo !== 'text' && m
        ? { path: String(m.path ?? ''), mime: String(m.mime ?? ''), nombre: typeof m.nombre === 'string' ? m.nombre.slice(0, 120) : null,
            bytes: typeof m.bytes === 'number' ? m.bytes : null, voz: m.voz === true }
        : null;
      const reintentar = typeof body.reintentar_id === 'string' && UUID_RE.test(body.reintentar_id) ? body.reintentar_id : null;
      if (!puenteConfigurado()) return json({ error: new PuenteSinConfigurar().message }, 503);
      const r = await responderDesdeBandeja(admin as unknown as BandejaDb, llamarWa, {
        conversacion_id: conv,
        texto: typeof body.texto === 'string' ? body.texto : '',
        tipo,
        media,
        client_id: body.client_id,
        reintentar_id: reintentar,
        responde_a: typeof body.responde_a === 'string' ? body.responde_a.slice(0, 200) : null,
        forzar: body.forzar === true,
        usuario: caller.id,
      });
      // El agente aprende de lo que el propietario envía (aprobado, editado o escrito por su cuenta). Nunca estorba al envío.
      let aprendizaje: string | null = null;
      if (tipo === 'text' && r.id && !reintentar && !r.en_curso) {
        try {
          const borrador = typeof body.borrador_id === 'string' && UUID_RE.test(body.borrador_id) ? body.borrador_id : null;
          const ap = await admin.rpc('wa_agente_aprender', {
            p_conv: conv, p_texto: typeof body.texto === 'string' ? body.texto : '', p_borrador: borrador, p_msg: r.id, p_user: caller.id,
          });
          if (ap.error) console.error('[agente] no se pudo aprender:', ap.error.message);
          else {
            const d = ap.data as DatosAprendizaje | null;
            aprendizaje = d?.origen ?? null;
            // Lo que el propietario envió (y el banco no tenía) vuelve al banco. Si falla, el envío y lo aprendido ya están a salvo.
            if (d?.aprendido && d.origen) {
              try { await aprenderEnBanco(admin as unknown as BandejaDb, d, typeof body.texto === 'string' ? body.texto : ''); }
              catch (e2) { console.error('[agente] no se pudo aprender para el banco:', e2 instanceof Error ? e2.message : String(e2)); }
            }
          }
        } catch (e) {
          console.error('[agente] no se pudo aprender:', e instanceof Error ? e.message : String(e));
        }
      }
      return json({ ...r, aprendizaje });
    }

    // ── AGENTE de la Bandeja (migración 0017) ─────────────────────────────
    if (body?.action === 'agente_estado') {
      // Sin la migración 0018 no existe la columna `motor`: se responde igual (el motor entonces es «claude», como antes).
      let { data, error } = await admin.from('wa_agente_config').select('modo, modelo, esfuerzo, espera_seg, motor').eq('id', 1).maybeSingle();
      if (error && /motor/.test(error.message)) {
        ({ data, error } = await admin.from('wa_agente_config').select('modo, modelo, esfuerzo, espera_seg').eq('id', 1).maybeSingle());
      }
      if (error) return json({ error: error.message }, 500);
      const { count } = await admin.from('wa_agente_banco').select('id', { count: 'exact', head: true }).eq('activo', true);
      return json({ ok: true, clave: claveAnthropicConfigurada(), config: data, banco: count ?? null });
    }

    if (body?.action === 'agente_banco_sembrar') {
      const { data, error } = await admin.rpc('wa_agente_banco_sembrar', { p: SEMILLAS });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, ...(data as Record<string, unknown>) });
    }

    if (body?.action === 'agente_generar') {
      const conv = body.conversacion_id;
      if (typeof conv !== 'string' || !UUID_RE.test(conv)) return json({ error: 'conversacion_id inválido.' }, 400);
      try {
        const r = await procesarConversacion(crearDepsAgente(), { convId: conv, manual: true });
        return json({ ok: true, ...r });
      } catch (e) {
        if (e instanceof SinClaveAnthropic) return json({ error: e.message, sin_clave: true }, 503);
        throw e;
      }
    }

    if (body?.action === 'agente_probar') {
      const mensaje = typeof body.mensaje === 'string' ? body.mensaje.trim().slice(0, 600) : '';
      if (!mensaje) return json({ error: 'Escribe lo que diría el cliente.' }, 400);
      const theme = typeof body.theme === 'string' && /^[a-z]{3,10}$/.test(body.theme) ? body.theme : 'default';
      const nombre = typeof body.nombre === 'string' && body.nombre.trim() ? body.nombre.trim().slice(0, 80) : 'Negocio de prueba';
      const historial = (Array.isArray(body.historial) ? body.historial : []).slice(-8)
        .filter((h: { d?: string; t?: string }) => (h?.d === 'cliente' || h?.d === 'nosotros') && typeof h?.t === 'string' && h.t.trim())
        .map((h: { d: 'cliente' | 'nosotros'; t: string }) => ({ d: h.d, t: h.t.trim().slice(0, 600) }));
      const [cfgRes, { data: ej }] = await Promise.all([
        admin.from('wa_agente_config').select('modelo, esfuerzo, motor').eq('id', 1).maybeSingle(),
        admin.from('wa_agente_aprendizaje').select('origen, contexto, texto_agente, texto_humano, intencion, nicho, created_at')
          .eq('activo', true).order('created_at', { ascending: false }).limit(60),
      ]);
      // Sin la migración 0018 la columna `motor` no existe: la consulta falla y se prueba con «claude», como antes.
      const cfg = cfgRes.error ? null : cfgRes.data;
      const motor: Motor = MOTORES.has(body.motor) ? body.motor : (MOTORES.has(cfg?.motor) ? cfg!.motor : cfgRes.error ? 'claude' : 'recuerdo');
      const ahora = new Date().toISOString();
      const mensajes = [
        { id: 'p-0', seq: 0, direccion: 'saliente' as const, tipo: 'template', texto: null, ts: ahora, humano: false, agente: false },
        ...historial.map((h: { d: 'cliente' | 'nosotros'; t: string }, i: number) => ({
          id: `p-${i + 1}`, seq: i + 1, direccion: h.d === 'cliente' ? 'entrante' as const : 'saliente' as const, tipo: 'text', texto: h.t, ts: ahora, humano: h.d === 'nosotros', agente: false,
        })),
        { id: 'p-ultimo', seq: 99, direccion: 'entrante' as const, tipo: 'text', texto: mensaje, ts: ahora, humano: false, agente: false },
      ];
      const ctx: ContextoAgente = {
        conversacion: { id: 'prueba', wa_id: '0', nombre_perfil: null, negocio: nombre, ultimo_entrante_at: ahora, pausado: false, envio_id: null, prospect_id: null },
        envio: { estado: typeof body.estado === 'string' && /^[a-z_]{3,20}$/.test(body.estado) ? body.estado : 'wa_enviado', rubro: null, theme, username: 'tu-negocio', categoria: null, ciudad: null, nombre },
        prospecto: null,
        config: { modo: 'supervisado', modelo: cfg?.modelo ?? 'claude-opus-5-5', esfuerzo: cfg?.esfuerzo ?? 'medium', espera_seg: 0, motor },
        mensajes,
        ultimo_entrante: { id: 'p-ultimo', tipo: 'text', texto: mensaje, ts: ahora },
        borrador_pendiente: null,
        ejemplos: (ej ?? []) as EjemploCtx[],
        respuestas_automaticas_24h: 0,
      };
      const previa = decidirSinModelo(ctx);
      if (previa?.accion === 'omitir') return json({ ok: true, accion: 'omitir', texto: '', nota: previa.motivo, intencion: 'otro', confianza: 'alta' });
      if (previa) return json({ ok: true, accion: 'traspasar', texto: '', nota: previa.nota, intencion: previa.intencion, confianza: 'alta' });
      try {
        const g = await generarConMotor(ctx, crearDepsAgente());
        return json({ ok: true, accion: g.accion, texto: g.texto, nota: g.nota, intencion: g.intencion, confianza: g.confianza, uso: g.uso, modelo: g.modelo, motor: g.motor ?? motor });
      } catch (e) {
        if (e instanceof SinClaveAnthropic) return json({ error: e.message, sin_clave: true }, 503);
        throw e;
      }
    }

    // ── BANDEJA: bajar y guardar el archivo de un mensaje (reintento manual) ──
    if (body?.action === 'wa_media') {
      const id = body.mensaje_id;
      if (typeof id !== 'string' || !UUID_RE.test(id)) return json({ error: 'mensaje_id inválido.' }, 400);
      if (!puenteConfigurado()) return json({ error: new PuenteSinConfigurar().message }, 503);
      const { data: m, error: mErr } = await admin.from('wa_mensajes').select('id, conversacion_id, media').eq('id', id).maybeSingle();
      if (mErr) return json({ error: mErr.message }, 500);
      if (!m) return json({ error: 'No encontré ese mensaje.' }, 404);
      if (!m.media?.id) return json({ error: 'Ese mensaje no tiene archivo.' }, 400);
      if (m.media.estado === 'guardado' && m.media.path) return json({ ok: true, path: m.media.path });
      const r = await guardarArchivo(admin as unknown as BandejaDb, llamarWa, {
        mensajeId: m.id, conversacionId: m.conversacion_id, mediaId: String(m.media.id), mime: m.media.mime ?? null,
      });
      return json(r);
    }

    // ── BANDEJA: traer los saludos que Connexo ya había enviado ───────────
    if (body?.action === 'wa_importar_saludos') {
      if (!puenteConfigurado()) return json({ error: new PuenteSinConfigurar().message }, 503);
      const r = await llamarWa({ action: 'historial_saludos' }, 60_000);
      const items = Array.isArray(r.items) ? r.items : [];
      const db = admin as unknown as BandejaDb;
      const res = await registrarSaludos(db, items);
      // Lo que ya habían respondido por botón antes de la bandeja (con su hora): da contexto y abre la ventana de 24 h si es reciente.
      const respuestas = Array.isArray(r.respuestas) ? r.respuestas : [];
      const resp = await registrarRespuestasPasadas(db, respuestas);
      return json({ ok: true, total: items.length, ...res, respuestas: resp });
    }

    return json({ error: 'Acción desconocida.' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const noAuth = /No autorizado/.test(msg);
    return json({ error: msg }, noAuth ? 401 : e instanceof PuenteSinConfigurar ? 503 : 500);
  }
});
