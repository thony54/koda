// Cliente admin (service_role) para las Edge Functions. SALTA RLS.
// La service_role key SOLO vive aquí, en los Secrets de Supabase — nunca en el
// navegador (regla de oro, sección 3).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export function getAdminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en los Secrets.');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Verifica que quien invoca la función esté autenticado (JWT de usuario) o sea
 * la propia service_role (pg_cron). Devuelve el user id o 'cron'.
 * No frena si es cron; sí exige Authorization presente.
 */
export async function requireCaller(req: Request, admin: SupabaseClient): Promise<string> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('No autorizado: falta el token.');

  // Si el token es la service_role key, es una llamada de cron/servidor.
  if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return 'cron';

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Error('No autorizado: token inválido.');
  return data.user.id;
}
