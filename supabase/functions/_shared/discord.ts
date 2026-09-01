// Helper compartido para postear a Discord vía webhook.
// Los webhooks son SECRETOS: viven en los Secrets de Supabase, nunca en el front.
//   DISCORD_WEBHOOK_HOT | _NUEVOS | _REPORTES | _ERRORES  (y _DEFAULT de respaldo)

/** Devuelve el webhook del canal, con _DEFAULT como respaldo. null si no hay ninguno. */
export function webhookFor(canal: string): string | null {
  const key = `DISCORD_WEBHOOK_${canal.toUpperCase()}`;
  return Deno.env.get(key) ?? Deno.env.get('DISCORD_WEBHOOK_DEFAULT') ?? null;
}

/** Hace el POST del contenido al webhook. Lanza si Discord responde con error. */
export async function postToDiscord(url: string, content: string): Promise<void> {
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

/**
 * Envío directo (best-effort) a un canal, sin pasar por la cola.
 * Nunca lanza: úsalo en rutas de error donde un fallo del webhook no debe
 * enmascarar el error original. Devuelve true si se envió.
 */
export async function tryPostToChannel(canal: string, content: string): Promise<boolean> {
  const url = webhookFor(canal);
  if (!url) return false;
  try {
    await postToDiscord(url, content);
    return true;
  } catch {
    return false;
  }
}
