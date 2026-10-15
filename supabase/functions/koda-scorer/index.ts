// koda-scorer (sección 7.3): calcula score, desglose y plan desde las señales, las reglas
// y —lo nuevo— el ESPACIO de cada usuario y lo que KODA aprendió de él.
//
// MULTIUSUARIO: las reglas de scoring son globales (las gestiona la cuenta propietaria);
// cada usuario las ajusta a su nicho con su propio espacio (koda_perfil) y la memoria
// de sus decisiones (koda_memoria). El plan CONECTA/PRO/ULTRA es de Connexo: solo se
// sugiere a prospectos de la cuenta propietaria.
//
// Qué se califica: lo que el normalizer dejó marcado (score_desglose = {}) y todo
// prospecto cuyo `score_version` quedó por debajo de la versión del espacio de su dueño
// (cambió su espacio o KODA aprendió algo). Se trabaja por lotes hasta agotar el tiempo
// y, si quedó trabajo, devuelve `pendientes: true` (el cron lo retoma).
// `{ all: true }` fuerza recalcular todo lo del que llama.
import { corsHeaders, json } from '../_shared/cors.ts';
import { getAdminClient, requireCaller } from '../_shared/supabaseAdmin.ts';
import { createOwnerCache } from '../_shared/owners.ts';
import { computeScore, type Memoria, type Perfil, type Rule, type ScoreLine } from '../_shared/scoring.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const PRESUPUESTO_MS = 40_000;
const LOTE = 200;
const PARALELO = 25;
const CERO = '00000000-0000-0000-0000-000000000000';

interface Fila {
  id: string;
  owner_id: string;
  score: number | null;
  plan_sugerido: string | null;
  score_desglose?: unknown;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  ciudad: string | null;
}

interface Contexto {
  esPropietario: boolean;
  /** Versión del espacio; 1 = sin espacio (así lo entiende koda_pendientes). */
  version: number;
  perfil: Perfil | null;
  memoria: Memoria | null;
}

/** ¿El desglose guardado es idéntico al recién calculado? (el jsonb no conserva el orden de las claves.) */
function mismoDesglose(guardado: unknown, nuevo: ScoreLine[]): boolean {
  if (!Array.isArray(guardado) || guardado.length !== nuevo.length) return false;
  return guardado.every((l, i) =>
    l?.clave === nuevo[i].clave && l?.puntos === nuevo[i].puntos && l?.descripcion === nuevo[i].descripcion);
}

/** Lee todas las filas de una consulta paginada (PostgREST limita a 1000 por petición). */
async function leerTodo<T>(consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; desde < 10_000; desde += 1000) {
    const { data } = await consulta(desde, desde + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function cargarContexto(admin: SupabaseClient, ownerId: string): Promise<Contexto> {
  const [{ data: prof }, { data: fila }] = await Promise.all([
    admin.from('profiles').select('es_propietario').eq('id', ownerId).maybeSingle(),
    admin.from('koda_perfil').select('*').eq('owner_id', ownerId).maybeSingle(),
  ]);

  const perfil: Perfil | null = fila
    ? {
        rubros: fila.rubros ?? [],
        ciudades: fila.ciudades ?? [],
        palabras_clave: fila.palabras_clave ?? [],
        palabras_excluidas: fila.palabras_excluidas ?? [],
        pesos: (fila.pesos ?? {}) as Record<string, number>,
        aprende: fila.aprende !== false,
      }
    : null;

  let memoria: Memoria | null = null;
  if (!perfil || perfil.aprende) {
    const { data: res } = await admin.rpc('koda_resumen', { p_owner: ownerId });
    const r = Array.isArray(res) ? res[0] : res;
    const decisiones = Number(r?.decisiones ?? 0);
    if (decisiones > 0) {
      const filas = await leerTodo<{ feature: string; pos: number; neg: number }>((d, h) =>
        admin.from('koda_memoria').select('feature, pos, neg').eq('owner_id', ownerId).order('feature').range(d, h));
      memoria = {
        items: new Map(filas.map((m) => [m.feature, { pos: Number(m.pos), neg: Number(m.neg) }])),
        decisiones,
        pesoPos: Number(r?.peso_pos ?? 0),
        pesoNeg: Number(r?.peso_neg ?? 0),
      };
    }
  }

  return { esPropietario: Boolean(prof?.es_propietario), version: fila?.version ?? 1, perfil, memoria };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = getAdminClient();
  const getOwner = createOwnerCache(admin);

  try {
    const caller = await requireCaller(req, admin);
    const body = await req.json().catch(() => ({}));
    const all = Boolean(body?.all);

    const { data: rules, error: rErr } = await admin
      .from('scoring_rules')
      .select('clave, descripcion, puntos, activa');
    if (rErr) throw rErr;

    // Umbral "caliente" configurable desde el panel (app_config). Fallback 75.
    const { data: cfg } = await admin.from('app_config').select('valor').eq('clave', 'hot_threshold').maybeSingle();
    const HOT = Number(cfg?.valor ?? 75) || 75;

    // Solo el cron y la cuenta propietaria califican lo de todos; cualquier otro usuario,
    // únicamente LO SUYO (y no ve ni cuenta lo de los demás).
    const soloDe = caller.esPropietario ? null : caller.id;

    const contextos = new Map<string, Promise<Contexto>>();
    const contextoDe = (ownerId: string) => {
      let c = contextos.get(ownerId);
      if (!c) { c = cargarContexto(admin, ownerId); contextos.set(ownerId, c); }
      return c;
    };

    const inicio = Date.now();
    const vistos = new Set<string>();
    let calificados = 0;
    let calientes = 0;
    let despues = CERO;
    let pendientes = false;

    while (true) {
      if (Date.now() - inicio > PRESUPUESTO_MS) { pendientes = true; break; }

      // Siguiente lote: todo (paginado por id) o solo lo pendiente.
      let lote: Fila[];
      if (all) {
        let q = admin.from('prospects')
          .select('id, owner_id, score, plan_sugerido, score_desglose, nombre, categoria, descripcion, ciudad')
          .gt('id', despues).order('id').limit(LOTE);
        if (soloDe) q = q.eq('owner_id', soloDe);
        const { data, error } = await q;
        if (error) throw error;
        lote = (data ?? []) as Fila[];
        if (lote.length) despues = lote[lote.length - 1].id;
      } else {
        const { data, error } = await admin.rpc('koda_pendientes', { p_owner: soloDe, p_limite: LOTE });
        if (error) throw error;
        lote = ((data ?? []) as Fila[]).filter((f) => !vistos.has(f.id));   // evita girar en falso si un UPDATE falló
      }
      if (!lote.length) break;
      lote.forEach((f) => vistos.add(f.id));

      const ids = lote.map((f) => f.id);
      const { data: sigs } = await admin.from('prospect_signals').select('prospect_id, clave').in('prospect_id', ids);
      const senales = new Map<string, string[]>();
      (sigs ?? []).forEach((s) => {
        const arr = senales.get(s.prospect_id) ?? [];
        arr.push(s.clave); senales.set(s.prospect_id, arr);
      });

      // Características (para lo aprendido) solo de los dueños que ya tienen memoria.
      const ctxs = new Map<string, Contexto>();
      for (const dueno of new Set(lote.map((f) => f.owner_id))) ctxs.set(dueno, await contextoDe(dueno));
      const conMemoria = lote.filter((f) => ctxs.get(f.owner_id)?.memoria).map((f) => f.id);
      const caracteristicas = new Map<string, string[]>();
      if (conMemoria.length) {
        const { data: feats } = await admin.rpc('koda_features_lote', { p_ids: conMemoria });
        ((feats ?? []) as { prospect_id: string; features: string[] }[]).forEach((x) => caracteristicas.set(x.prospect_id, x.features));
      }

      // Los que no cambiaron solo avanzan de versión (un único UPDATE por versión): así
      // recalificar tras cada decisión del usuario no reescribe cientos de filas en vano.
      const sinCambio = new Map<number, string[]>();

      for (let i = 0; i < lote.length; i += PARALELO) {
        await Promise.all(lote.slice(i, i + PARALELO).map(async (p) => {
          const ctx = ctxs.get(p.owner_id)!;
          const { score, desglose, plan } = computeScore({
            signals: senales.get(p.id) ?? [],
            prospect: { nombre: p.nombre, categoria: p.categoria, descripcion: p.descripcion, ciudad: p.ciudad },
            rules: (rules ?? []) as Rule[],
            perfil: ctx.perfil,
            memoria: ctx.memoria,
            features: caracteristicas.get(p.id) ?? [],
            esPropietario: ctx.esPropietario,
          });

          if (p.score === score && (p.plan_sugerido ?? null) === plan && mismoDesglose(p.score_desglose, desglose)) {
            const ids = sinCambio.get(ctx.version) ?? [];
            ids.push(p.id); sinCambio.set(ctx.version, ids);
            return;
          }

          const { error: uErr } = await admin.from('prospects')
            .update({ score, score_desglose: desglose, plan_sugerido: plan, score_version: ctx.version })
            .eq('id', p.id);
          if (uErr) { console.error('[scorer] no se pudo guardar', p.id, uErr.message); return; }
          calificados++;

          const eraCaliente = (p.score ?? 0) >= HOT;
          if (score >= HOT && !eraCaliente) {
            calientes++;
            const owner = await getOwner(p.owner_id);
            if (owner.webhooks.hot) {
              await admin.from('notifications').insert({
                prospect_id: p.id, owner_id: p.owner_id, canal: 'hot', payload: { score, plan },
              });
            }
          }
        }));
      }

      for (const [version, ids] of sinCambio) {
        const { error: vErr } = await admin.from('prospects').update({ score_version: version }).in('id', ids);
        if (vErr) console.error('[scorer] no se pudo avanzar la versión', vErr.message);
        else calificados += ids.length;
      }

      if (lote.length < LOTE && all) break;
    }

    return json({ ok: true, calificados, calientes, pendientes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from('notifications').insert({ canal: 'errores', payload: { texto: `Scorer falló: ${msg}` } });
    return json({ error: msg }, 500);
  }
});
