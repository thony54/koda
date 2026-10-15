/**
 * Secretos PROPIOS del usuario (API key de Google Places, webhooks de Discord).
 * Se guardan cifrados en Supabase Vault. El navegador solo puede ESCRIBIRLOS y
 * ver los últimos 4 caracteres: nunca se pueden volver a leer completos.
 */
import { db } from '@/lib/supabase';

export type SecretKey =
  | 'google_places_api_key'
  | 'discord_webhook_hot'
  | 'discord_webhook_nuevos'
  | 'discord_webhook_reportes'
  | 'discord_webhook_errores';

export interface SecretStatus {
  clave: SecretKey;
  ultimos4: string | null;
  updated_at: string;
}

export async function getMySecretsStatus(): Promise<Record<string, SecretStatus>> {
  const { data, error } = await db.rpc('my_secrets_status');
  if (error) throw error;
  const out: Record<string, SecretStatus> = {};
  ((data ?? []) as SecretStatus[]).forEach((s) => { out[s.clave] = s; });
  return out;
}

export async function setMySecret(clave: SecretKey, valor: string): Promise<void> {
  const { error } = await db.rpc('set_my_secret', { p_clave: clave, p_valor: valor });
  if (error) throw new Error(error.message);
}

export async function deleteMySecret(clave: SecretKey): Promise<void> {
  const { error } = await db.rpc('delete_my_secret', { p_clave: clave });
  if (error) throw new Error(error.message);
}
