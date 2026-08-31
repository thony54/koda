// koda-scorer (sección 7.3): calcula score, desglose y plan desde las señales y
// las reglas activas. Si un prospecto cruza a la banda caliente, encola aviso.
import { corsHeaders, json } from '../_shared/cors.ts';
import { getAdminClient, requireCaller } from '../_shared/supabaseAdmin.ts';
import { computeScore, type Rule } from '../_shared/scoring.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = getAdminClient();

  try {
    await requireCaller(req, admin);
    const body = await req.json().catch(() => ({}));
    const all = Boolean(body?.all);

    const { data: rules, error: rErr } = await admin
      .from('scoring_rules')
      .select('clave, descripcion, puntos, activa');
    if (rErr) throw rErr;

    // Prospectos a calificar: los recién normalizados (desglose vacío) o todos.
    let q = admin.from('prospects').select('id, score').limit(300);
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

      const eraCaliente = (p.score ?? 0) >= 75;
      if (score >= 75 && !eraCaliente) {
        calientes++;
        await admin.from('notifications').insert({ prospect_id: p.id, canal: 'hot', payload: { score, plan } });
      }
    }

    return json({ ok: true, calificados: pending.length, calientes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from('notifications').insert({ canal: 'errores', payload: { texto: `Scorer falló: ${msg}` } });
    return json({ error: msg }, 500);
  }
});
