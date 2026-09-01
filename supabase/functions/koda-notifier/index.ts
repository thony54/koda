// koda-notifier (Fase 3): envía a Discord las notificaciones encoladas.
// - Modo normal `{}`: toma notifications pendientes y las manda al webhook del canal.
// - `{ check: true }`: devuelve qué webhooks están configurados (sin exponer URLs).
// - `{ test: true, canal }`: manda un mensaje de prueba al canal indicado.
//
// Los webhooks son SECRETOS: viven en los Secrets de Supabase, nunca en el front.
//   DISCORD_WEBHOOK_HOT | _NUEVOS | _REPORTES | _ERRORES  (y _DEFAULT de respaldo)
import { corsHeaders, json } from '../_shared/cors.ts';
import { getAdminClient, requireCaller } from '../_shared/supabaseAdmin.ts';

const CANALES = ['hot', 'nuevos', 'reportes', 'errores'] as const;
type Canal = (typeof CANALES)[number];
const MAX_INTENTOS = 3;

function webhookFor(canal: string): string | null {
  const key = `DISCORD_WEBHOOK_${canal.toUpperCase()}`;
  return Deno.env.get(key) ?? Deno.env.get('DISCORD_WEBHOOK_DEFAULT') ?? null;
}

async function postToDiscord(url: string, content: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 2000 chars es el tope de Discord.
    body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord ${res.status}: ${body.slice(0, 200)}`);
  }
}

// deno-lint-ignore no-explicit-any
function fmt(canal: string, payload: any, prospect: any): string {
  if (canal === 'hot' && prospect) {
    const partes = [
      `🔥 **Prospecto caliente** — ${prospect.nombre}`,
      prospect.ciudad ? `📍 ${prospect.ciudad}` : null,
      `⭐ Score ${payload?.score ?? prospect.score ?? '—'}${payload?.plan ? ` · Plan sugerido: ${payload.plan}` : ''}`,
      prospect.whatsapp ? `💬 WhatsApp: ${prospect.whatsapp}` : null,
      prospect.website ? `🌐 ${prospect.website}` : '🚫 Sin web',
    ].filter(Boolean);
    return partes.join('\n');
  }
  if (payload?.texto) return String(payload.texto);
  return `📣 ${canal}: ${JSON.stringify(payload ?? {})}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = getAdminClient();

  try {
    await requireCaller(req, admin);
    const body = await req.json().catch(() => ({}));

    // ── Modo diagnóstico: qué webhooks existen ────────────────────────────
    if (body?.check) {
      const estado = Object.fromEntries(
        CANALES.map((c) => [c, Boolean(Deno.env.get(`DISCORD_WEBHOOK_${c.toUpperCase()}`) ?? Deno.env.get('DISCORD_WEBHOOK_DEFAULT'))]),
      );
      return json({ ok: true, webhooks: estado });
    }

    // ── Modo prueba: envío inmediato a un canal ───────────────────────────
    if (body?.test) {
      const canal: Canal = CANALES.includes(body.canal) ? body.canal : 'hot';
      const url = webhookFor(canal);
      if (!url) return json({ error: `No hay webhook configurado para "${canal}". Agrega el secret DISCORD_WEBHOOK_${canal.toUpperCase()}.` }, 400);
      await postToDiscord(url, `✅ Prueba de KODA — canal **${canal}**. Si ves esto, las notificaciones funcionan.`);
      return json({ ok: true, canal });
    }

    // ── Modo normal: vaciar la cola de pendientes ─────────────────────────
    const { data: pend, error } = await admin
      .from('notifications')
      .select('id, prospect_id, canal, payload, intento')
      .eq('status', 'pendiente')
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) throw error;
    if (!pend || pend.length === 0) return json({ ok: true, enviados: 0 });

    // Prospectos referidos (para los mensajes "hot").
    const pids = [...new Set(pend.map((n) => n.prospect_id).filter(Boolean))] as string[];
    const byId = new Map<string, Record<string, unknown>>();
    if (pids.length) {
      const { data: ps } = await admin.from('prospects').select('id, nombre, ciudad, score, whatsapp, website').in('id', pids);
      (ps ?? []).forEach((p) => byId.set(p.id as string, p));
    }

    let enviados = 0, fallidos = 0;
    for (const n of pend) {
      const url = webhookFor(n.canal);
      if (!url) {
        await admin.from('notifications').update({ status: 'error', error_mensaje: `Sin webhook para "${n.canal}"` }).eq('id', n.id);
        fallidos++;
        continue;
      }
      try {
        await postToDiscord(url, fmt(n.canal, n.payload, n.prospect_id ? byId.get(n.prospect_id) : null));
        await admin.from('notifications').update({ status: 'enviado', enviado_at: new Date().toISOString() }).eq('id', n.id);
        enviados++;
      } catch (e) {
        const intento = (n.intento ?? 0) + 1;
        const msg = e instanceof Error ? e.message : String(e);
        await admin.from('notifications').update({
          status: intento >= MAX_INTENTOS ? 'error' : 'pendiente',
          intento,
          error_mensaje: msg,
        }).eq('id', n.id);
        fallidos++;
      }
    }

    return json({ ok: true, enviados, fallidos });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
