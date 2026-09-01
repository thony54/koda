/** Capa de datos de notificaciones Discord y configuración (app_config). */
import { db, supabase } from '@/lib/supabase';

async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const b = await ctx.json(); if (b?.error) msg = b.error; } catch { /* no-JSON */ }
    }
    throw new Error(msg);
  }
  return data as T;
}

export type Canal = 'hot' | 'nuevos' | 'reportes' | 'errores';
export type WebhookStatus = Record<Canal, boolean>;

/** Qué webhooks están configurados en Supabase (sin exponer las URLs). */
export async function getWebhookStatus(): Promise<WebhookStatus> {
  const r = await invokeFn<{ webhooks: WebhookStatus }>('koda-notifier', { check: true });
  return r.webhooks;
}

/** Envía un mensaje de prueba al canal indicado. */
export async function sendTestNotification(canal: Canal): Promise<void> {
  await invokeFn('koda-notifier', { test: true, canal });
}

/** Vacía la cola de notificaciones pendientes (envío manual). */
export async function flushNotifications(): Promise<{ enviados: number; fallidos: number }> {
  return invokeFn('koda-notifier', {});
}

/** Genera el resumen (digest) y lo encola. */
export async function runDigest(): Promise<{ nuevos: number; calientes: number }> {
  return invokeFn('koda-digest', {});
}

// ── Configuración (app_config) ──────────────────────────────────────────────
export async function getConfigNumber(clave: string, fallback: number): Promise<number> {
  const { data } = await db.from('app_config').select('valor').eq('clave', clave).maybeSingle();
  const v = (data as { valor: unknown } | null)?.valor;
  return typeof v === 'number' ? v : Number(v ?? fallback) || fallback;
}

export async function setConfigNumber(clave: string, valor: number): Promise<void> {
  const { data, error } = await db
    .from('app_config')
    .update({ valor, updated_at: new Date().toISOString() })
    .eq('clave', clave)
    .select('clave');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('No se pudo guardar la configuración. Tu usuario debe tener rol super_admin o analista y estar activo (permisos RLS).');
  }
}

// ── Historial reciente de notificaciones ────────────────────────────────────
export interface NotifRow {
  id: string;
  canal: string;
  status: string;
  intento: number;
  error_mensaje: string | null;
  enviado_at: string | null;
  created_at: string;
}

export async function listRecentNotifications(limit = 20): Promise<NotifRow[]> {
  const { data, error } = await db
    .from('notifications')
    .select('id, canal, status, intento, error_mensaje, enviado_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as NotifRow[];
}
