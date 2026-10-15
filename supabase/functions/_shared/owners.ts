// Datos de un DUEÑO (usuario) que necesitan las Edge Functions: estado, permisos,
// tope de costo y webhooks de Discord. Se cachea por invocación (un fetch por dueño).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { CANALES, type Canal, esWebhookDiscord, webhookFor } from './discord.ts';

export const SECRET_GOOGLE = 'google_places_api_key';
export const secretWebhook = (canal: Canal) => `discord_webhook_${canal}`;

export interface OwnerInfo {
  id: string | null;
  /** super_admin (o aviso de sistema): tiene todas las funciones habilitadas. */
  isAdmin: boolean;
  /**
   * Cuenta propietaria (o aviso de sistema sin dueño): ÚNICA que puede usar los secretos
   * globales del proyecto (API key de Google, webhooks de Discord). Cualquier otro
   * usuario —aunque sea super_admin— solo usa los suyos propios.
   */
  esPropietario: boolean;
  activo: boolean;
  permisos: string[];
  /** Tope mensual de costo propio; null = usar el valor por defecto de la función. */
  tope: number | null;
  /** Webhook efectivo por canal: el propio del usuario, o el global si es admin. */
  webhooks: Record<Canal, string | null>;
}

/** Descifra secretos del usuario (solo service_role puede llamar a esta RPC). */
export async function getOwnerSecrets(
  admin: SupabaseClient,
  ownerId: string,
  claves: string[],
): Promise<Record<string, string>> {
  const { data, error } = await admin.rpc('get_user_secrets', { p_user: ownerId, p_claves: claves });
  if (error) throw new Error(`No se pudieron leer los secretos del usuario: ${error.message}`);
  return (data ?? {}) as Record<string, string>;
}

function globalWebhooks(): Record<Canal, string | null> {
  return Object.fromEntries(CANALES.map((c) => [c, webhookFor(c)])) as Record<Canal, string | null>;
}

async function loadOwner(admin: SupabaseClient, ownerId: string | null): Promise<OwnerInfo> {
  // Aviso de sistema sin dueño → se comporta como el administrador (webhooks globales).
  if (!ownerId) {
    return { id: null, isAdmin: true, esPropietario: true, activo: true, permisos: [], tope: null, webhooks: globalWebhooks() };
  }

  const { data: p } = await admin
    .from('profiles')
    .select('rol, activo, permisos, tope_costo_mensual, es_propietario')
    .eq('id', ownerId)
    .maybeSingle();

  const isAdmin = p?.rol === 'super_admin';
  const esPropietario = Boolean(p?.es_propietario);
  // Si Vault falla, no frenamos la ingesta: solo se pierden los avisos a Discord.
  let propios: Record<string, string> = {};
  try {
    propios = await getOwnerSecrets(admin, ownerId, CANALES.map(secretWebhook));
  } catch (e) {
    console.error('[owners] no se pudieron leer los webhooks de', ownerId, e instanceof Error ? e.message : e);
  }
  // Los webhooks globales son del propietario: otro usuario jamás publica en esos canales.
  const globales = esPropietario ? globalWebhooks() : null;

  const webhooks = {} as Record<Canal, string | null>;
  for (const c of CANALES) {
    const propio = propios[secretWebhook(c)];
    webhooks[c] = propio && esWebhookDiscord(propio) ? propio : (globales?.[c] ?? null);
  }

  return {
    id: ownerId,
    isAdmin,
    esPropietario,
    activo: Boolean(p?.activo),
    permisos: (p?.permisos ?? []) as string[],
    tope: p?.tope_costo_mensual != null ? Number(p.tope_costo_mensual) : null,
    webhooks,
  };
}

/** Devuelve una función con caché: `await getOwner(id)` consulta la base solo una vez. */
export function createOwnerCache(admin: SupabaseClient) {
  const cache = new Map<string, Promise<OwnerInfo>>();
  return (ownerId: string | null): Promise<OwnerInfo> => {
    const key = ownerId ?? 'sistema';
    let hit = cache.get(key);
    if (!hit) {
      hit = loadOwner(admin, ownerId);
      cache.set(key, hit);
    }
    return hit;
  };
}
