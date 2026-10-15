// Cliente admin (service_role) para las Edge Functions. SALTA RLS.
// La service_role key SOLO vive aquí, en los Secrets de Supabase — nunca en el
// navegador (regla de oro, sección 3).
//
// MULTIUSUARIO: como service_role se salta RLS, cada función debe aplicar a mano
// el aislamiento por dueño. `requireCaller` identifica quién llama y `can()` /
// `caller.isAdmin` sirven para decidir qué puede tocar.
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

export interface Caller {
  /** uuid del usuario, o 'cron' si llama pg_cron / el servidor con la service_role. */
  id: string;
  isCron: boolean;
  /** super_admin (o cron): puede operar sobre datos de cualquier dueño. */
  isAdmin: boolean;
  rol: string | null;
  permisos: string[];
}

/**
 * Verifica que quien invoca la función esté autenticado Y activo (JWT de usuario)
 * o sea la propia service_role (pg_cron). Lanza si no.
 */
export async function requireCaller(req: Request, admin: SupabaseClient): Promise<Caller> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('No autorizado: falta el token.');

  // Si el token es la service_role key, es una llamada de cron/servidor.
  if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    return { id: 'cron', isCron: true, isAdmin: true, rol: 'super_admin', permisos: [] };
  }

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Error('No autorizado: token inválido.');

  const { data: prof } = await admin
    .from('profiles')
    .select('rol, activo, permisos')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!prof || !prof.activo) throw new Error('No autorizado: tu cuenta está desactivada.');

  return {
    id: data.user.id,
    isCron: false,
    isAdmin: prof.rol === 'super_admin',
    rol: prof.rol,
    permisos: (prof.permisos ?? []) as string[],
  };
}

/** ¿El que llama tiene esta función habilitada? (el super_admin siempre.) */
export function can(caller: Caller, permiso: string): boolean {
  return caller.isAdmin || caller.permisos.includes(permiso);
}
