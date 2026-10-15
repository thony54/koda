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

/** Comparación en tiempo constante (evita filtrar el secreto por tiempos de respuesta). */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

const CRON_CALLER: Caller = { id: 'cron', isCron: true, isAdmin: true, rol: 'super_admin', permisos: [] };

/**
 * Verifica que quien invoca la función esté autenticado Y activo (JWT de usuario)
 * o sea el cron. Lanza si no.
 *
 * pg_cron NO usa la service_role: manda la cabecera `x-cron-secret` con el secreto
 * compartido `CRON_SECRET` (Secrets de la función + Vault de la base; ver migración
 * 0007). Por eso koda-normalizer / scorer / notifier / digest se despliegan con
 * verify_jwt = false (ver supabase/config.toml): el gateway no puede validar esa
 * llamada, así que SIEMPRE debe pasar por esta función antes de hacer nada.
 */
export async function requireCaller(req: Request, admin: SupabaseClient): Promise<Caller> {
  // ¿Llamada del cron? Si trae la cabecera y no coincide, se rechaza sin más.
  const cronHeader = req.headers.get('x-cron-secret');
  if (cronHeader !== null) {
    const expected = Deno.env.get('CRON_SECRET');
    if (!expected || !safeEqual(cronHeader, expected)) throw new Error('No autorizado: secreto de cron inválido.');
    return CRON_CALLER;
  }

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('No autorizado: falta el token.');

  // Llamada de servidor con la propia service_role key (p. ej. pruebas por curl).
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (serviceKey && safeEqual(token, serviceKey)) return CRON_CALLER;

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
