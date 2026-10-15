// Helper compartido para postear a Discord vía webhook.
//
// MULTIUSUARIO: cada usuario guarda SUS webhooks (cifrados en Vault, ver
// 0006_multiusuario.sql). Los secretos globales de Supabase
//   DISCORD_WEBHOOK_HOT | _NUEVOS | _REPORTES | _ERRORES  (y _DEFAULT de respaldo)
// quedan SOLO como respaldo del super_admin y de los avisos de sistema sin dueño.

export const CANALES = ['hot', 'nuevos', 'reportes', 'errores'] as const;
export type Canal = (typeof CANALES)[number];

/** Webhook GLOBAL del canal (secreto de Supabase), con _DEFAULT de respaldo. */
export function webhookFor(canal: string): string | null {
  const key = `DISCORD_WEBHOOK_${canal.toUpperCase()}`;
  return Deno.env.get(key) ?? Deno.env.get('DISCORD_WEBHOOK_DEFAULT') ?? null;
}

const DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com']);

/**
 * Los webhooks los escribe el usuario: solo aceptamos URLs reales de Discord para
 * que nadie use la función como proxy hacia otros servidores (SSRF).
 */
export function esWebhookDiscord(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && DISCORD_HOSTS.has(u.hostname) && u.pathname.startsWith('/api/webhooks/');
  } catch {
    return false;
  }
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
 * Envío directo (best-effort) a una URL, sin pasar por la cola.
 * Nunca lanza: úsalo en rutas de error donde un fallo del webhook no debe
 * enmascarar el error original. Devuelve true si se envió.
 */
export async function tryPost(url: string | null, content: string): Promise<boolean> {
  if (!url) return false;
  try {
    await postToDiscord(url, content);
    return true;
  } catch {
    return false;
  }
}
