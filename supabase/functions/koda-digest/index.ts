// koda-digest (Fase 3): arma un resumen y lo ENCOLA como notificación 'reportes'.
// El koda-notifier lo envía a Discord en su próxima corrida. Así el digest reutiliza
// el reintento y el manejo de webhooks del notifier.
// Body opcional: { periodo_horas?: number } (default 24).
import { corsHeaders, json } from '../_shared/cors.ts';
import { getAdminClient, requireCaller } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = getAdminClient();

  try {
    await requireCaller(req, admin);
    const body = await req.json().catch(() => ({}));
    const horas = Number(body?.periodo_horas ?? 24) || 24;
    const desde = new Date(Date.now() - horas * 3600_000).toISOString();

    const { data: cfg } = await admin.from('app_config').select('valor').eq('clave', 'hot_threshold').maybeSingle();
    const HOT = Number(cfg?.valor ?? 75) || 75;

    const { data: nuevos } = await admin
      .from('prospects')
      .select('id, nombre, ciudad, score, assigned_to')
      .gte('first_seen_at', desde);
    const lista = nuevos ?? [];

    const calientes = lista.filter((p) => (p.score ?? 0) >= HOT);
    const { count: sinAsignar } = await admin
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .gte('score', HOT)
      .is('assigned_to', null);

    // Top ciudades del periodo.
    const porCiudad = new Map<string, number>();
    lista.forEach((p) => { const c = p.ciudad ?? '—'; porCiudad.set(c, (porCiudad.get(c) ?? 0) + 1); });
    const topCiudades = [...porCiudad.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    const top3 = [...lista].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3);

    const texto = [
      `📊 **Resumen KODA — últimas ${horas} h**`,
      `• Nuevos prospectos: **${lista.length}**`,
      `• Calientes nuevos (≥${HOT}): **${calientes.length}**`,
      `• Calientes sin asignar (total): **${sinAsignar ?? 0}**`,
      topCiudades.length ? `\n🏙️ Por ciudad: ${topCiudades.map(([c, n]) => `${c} (${n})`).join(' · ')}` : null,
      top3.length ? `\n🏆 Mejores: ${top3.map((p) => `${p.nombre} [${p.score}]`).join(', ')}` : null,
    ].filter(Boolean).join('\n');

    await admin.from('notifications').insert({ canal: 'reportes', payload: { texto } });

    return json({ ok: true, nuevos: lista.length, calientes: calientes.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from('notifications').insert({ canal: 'errores', payload: { texto: `Digest falló: ${msg}` } });
    return json({ error: msg }, 500);
  }
});
