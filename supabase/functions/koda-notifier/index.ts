// koda-notifier (Fase 3): envía a Discord las notificaciones encoladas.
// - Modo normal `{}`: toma notifications pendientes y las manda al webhook del canal
//   DEL DUEÑO de cada notificación.
// - `{ check: true }`: devuelve qué webhooks tiene configurados quien llama (sin exponer URLs).
// - `{ test: true, canal }`: manda un mensaje de prueba al webhook de quien llama.
//
// MULTIUSUARIO: cada usuario guarda sus propios webhooks (cifrados en Vault, se
// configuran en Configuración → Integraciones). Los secretos globales
//   DISCORD_WEBHOOK_HOT | _NUEVOS | _REPORTES | _ERRORES  (y _DEFAULT)
// solo respaldan al super_admin y a los avisos de sistema sin dueño.
import { corsHeaders, json } from '../_shared/cors.ts';
import { getAdminClient, requireCaller } from '../_shared/supabaseAdmin.ts';
import { CANALES, type Canal, postToDiscord } from '../_shared/discord.ts';
import { createOwnerCache } from '../_shared/owners.ts';

const MAX_INTENTOS = 3;

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
  if (canal === 'nuevos' && prospect) {
    const partes = [
      `🆕 **Nuevo prospecto** — ${prospect.nombre}`,
      prospect.ciudad ? `📍 ${prospect.ciudad}` : null,
      `⭐ Score ${prospect.score ?? '—'}`,
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
  const getOwner = createOwnerCache(admin);

  try {
    const caller = await requireCaller(req, admin);
    const body = await req.json().catch(() => ({}));
    // Para check/test, "quien llama" es su propio dueño (cron = avisos de sistema).
    const callerOwnerId = caller.isCron ? null : caller.id;

    // ── Modo diagnóstico: qué webhooks tiene quien llama ───────────────────
    if (body?.check) {
      const owner = await getOwner(callerOwnerId);
      const estado = Object.fromEntries(CANALES.map((c) => [c, Boolean(owner.webhooks[c])]));
      return json({ ok: true, webhooks: estado });
    }

    // ── Modo prueba: envío inmediato al webhook de quien llama ─────────────
    if (body?.test) {
      const canal: Canal = CANALES.includes(body.canal) ? body.canal : 'hot';
      const owner = await getOwner(callerOwnerId);
      const url = owner.webhooks[canal];
      if (!url) {
        return json({ error: `No tienes un webhook configurado para "${canal}". Agrégalo en Configuración → Integraciones.` }, 400);
      }
      await postToDiscord(url, `✅ Prueba de KODA — canal **${canal}**. Si ves esto, las notificaciones funcionan.`);
      return json({ ok: true, canal });
    }

    // ── Modo normal: vaciar la cola de pendientes ─────────────────────────
    const { data: pend, error } = await admin
      .from('notifications')
      .select('id, prospect_id, owner_id, canal, payload, intento')
      .eq('status', 'pendiente')
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) throw error;
    if (!pend || pend.length === 0) return json({ ok: true, enviados: 0 });

    // Prospectos referidos (para los mensajes "hot" / "nuevos").
    const pids = [...new Set(pend.map((n) => n.prospect_id).filter(Boolean))] as string[];
    const byId = new Map<string, Record<string, unknown>>();
    if (pids.length) {
      const { data: ps } = await admin.from('prospects').select('id, nombre, ciudad, score, whatsapp, website').in('id', pids);
      (ps ?? []).forEach((p) => byId.set(p.id as string, p));
    }

    let enviados = 0, fallidos = 0;
    for (const n of pend) {
      const owner = await getOwner((n.owner_id as string | null) ?? null);
      const url = owner.webhooks[n.canal as Canal];

      if (!url) {
        // Admin / sistema: sigue siendo un error visible. Un usuario sin webhook
        // simplemente no usa ese canal: se marca "omitido" sin ruido.
        await admin.from('notifications').update({
          status: owner.isAdmin ? 'error' : 'omitido',
          error_mensaje: `Sin webhook para "${n.canal}"`,
        }).eq('id', n.id);
        if (owner.isAdmin) fallidos++;
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
