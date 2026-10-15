/**
 * Alta y administración de cuentas (solo Super Admin). Crear usuarios en Supabase
 * Auth necesita la service_role, así que pasa por la Edge Function `koda-users`.
 */
import { supabase } from '@/lib/supabase';
import type { PermissionKey, UserRole } from '@/types/database';

async function invokeUsers<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('koda-users', { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const b = await ctx.json(); if (b?.error) msg = b.error; } catch { /* cuerpo no-JSON */ }
    }
    throw new Error(msg);
  }
  return data as T;
}

export interface NewUserInput {
  email: string;
  password: string;
  nombre?: string;
  rol: UserRole;
  permisos: PermissionKey[];
  tope_costo_mensual?: number | null;
}

export async function createUser(input: NewUserInput): Promise<{ id: string; email: string }> {
  const r = await invokeUsers<{ user: { id: string; email: string } }>({ action: 'create', ...input });
  return r.user;
}

export async function resetUserPassword(userId: string, password: string): Promise<void> {
  await invokeUsers({ action: 'reset_password', user_id: userId, password });
}

/** Contraseña temporal legible (sin caracteres que se confundan: 0/O, 1/l/I). */
export function generatePassword(length = 12): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('');
}
