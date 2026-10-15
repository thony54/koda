// koda-scorer (sección 7.3): calcula score, desglose y plan desde las señales y
// las reglas activas. Si un prospecto cruza a la banda caliente, encola aviso.
//
// MULTIUSUARIO: las reglas de scoring son globales (las gestiona la cuenta propietaria).
// El aviso "caliente" se encola con el dueño del prospecto y solo si ese dueño
// tiene webhook de Discord para el canal `hot`.
import { corsHeaders, json } from '../_shared/cors.ts';
import { getAdminClient, requireCaller } from '../_shared/supabaseAdmin.ts';
import { createOwnerCache } from '../_shared/owners.ts';
import { computeScore, type Rule } from '../_shared/scoring.ts';

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

    // Prospectos a calificar: los recién normalizados (desglose vacío) o todos.
    // Solo el cron y la cuenta propietaria procesan prospectos de todos; cualquier otro
    // usuario califica únicamente LO SUYO (y no ve ni cuenta lo de los demás).
    let q = admin.from('prospects').select('id, score, owner_id').limit(300);
    if (!caller.esPropietario) q = q.eq('owner_id', caller.id);
    if (!all) q = q.filter('score_desglose', 'eq', '{}');
    const { data: pending, error: pErr } = await q;
    if (pErr) throw pErr;
    if (!pending || pending.length === 0) return json({ ok: true, calificados: 0, calientes: 0 });

    const ids = pending.map((p) => p.id);
    const { data: sigs } = await admin.from('prospect_signals').select('prospect_id, clave').in('prospect_id', ids);
    const byProspect = new Map<string, string[]>();
    (sigs ?? []).forEach((s) => {
      const arr = byProspect.get(s.prospect_id) ?? [];
      arr.push(s.clave); byProspect.set(s.prospect_id, arr);
    });

    let calientes = 0;
    for (const p of pending) {
      const signals = byProspect.get(p.id) ?? [];
      const { score, desglose, plan } = computeScore(signals, (rules ?? []) as Rule[]);
      await admin.from('prospects').update({ score, score_desglose: desglose, plan_sugerido: plan }).eq('id', p.id);

      const eraCaliente = (p.score ?? 0) >= HOT;
      if (score >= HOT && !eraCaliente) {
        calientes++;
        const owner = await getOwner(p.owner_id as string);
        if (owner.webhooks.hot) {
          await admin.from('notifications').insert({
            prospect_id: p.id, owner_id: p.owner_id, canal: 'hot', payload: { score, plan },
          });
        }
      }
    }

    return json({ ok: true, calificados: pending.length, calientes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from('notifications').insert({ canal: 'errores', payload: { texto: `Scorer falló: ${msg}` } });
    return json({ error: msg }, 500);
  }
});
