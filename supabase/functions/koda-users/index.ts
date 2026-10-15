// koda-users: administración de usuarios. SOLO el super_admin.
// Crear cuentas requiere la service_role (Auth Admin API), por eso vive aquí y
// no en el navegador. No hay registro público: todo usuario nace desde el panel.
//
// Acciones:
//   { action: 'create', email, password, nombre?, rol?, permisos?, tope_costo_mensual? }
//   { action: 'reset_password', user_id, password }
//   { action: 'global_status' }  → { google_places: boolean } (¿existe la clave global?)
import { corsHeaders, json } from '../_shared/cors.ts';
import { getAdminClient, requireCaller } from '../_shared/supabaseAdmin.ts';
import { ROLES_VALIDOS, sanearPermisos } from '../_shared/permisos.ts';

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = getAdminClient();

  try {
    const caller = await requireCaller(req, admin);
    if (caller.isCron || caller.rol !== 'super_admin') {
      return json({ error: 'Solo el Super Admin puede administrar usuarios.' }, 403);
    }

    const body = await req.json().catch(() => ({}));

    // ── Crear usuario ─────────────────────────────────────────────────────
    if (body?.action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const nombre = String(body.nombre ?? '').trim() || email;
      const rol = ROLES_VALIDOS.includes(body.rol) ? body.rol : 'analista';
      const permisos = sanearPermisos(body.permisos);
      const tope = body.tope_costo_mensual === null || body.tope_costo_mensual === undefined || body.tope_costo_mensual === ''
        ? null
        : Number(body.tope_costo_mensual);

      if (!EMAIL_RE.test(email)) return json({ error: 'El correo no es válido.' }, 400);
      if (password.length < MIN_PASSWORD) return json({ error: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.` }, 400);
      if (tope !== null && (!Number.isFinite(tope) || tope < 0)) return json({ error: 'El tope de costo debe ser un número positivo.' }, 400);

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nombre },
      });
      if (cErr || !created.user) {
        const ya = /already|registered|exists/i.test(cErr?.message ?? '');
        return json({ error: ya ? 'Ya existe un usuario con ese correo.' : (cErr?.message ?? 'No se pudo crear el usuario.') }, ya ? 409 : 400);
      }
      const uid = created.user.id;

      // El trigger handle_new_user ya creó la fila (inactiva): aquí se completa y habilita.
      const { error: pErr } = await admin.from('profiles').upsert({
        id: uid,
        email,
        nombre,
        rol,
        permisos,
        activo: true,
        creado_por: caller.id,
        tope_costo_mensual: tope,
      }, { onConflict: 'id' });
      if (pErr) {
        // No dejar una cuenta de Auth huérfana sin perfil.
        await admin.auth.admin.deleteUser(uid);
        return json({ error: `No se pudo crear el perfil: ${pErr.message}` }, 500);
      }

      await admin.from('audit_log').insert({
        actor_id: caller.id,
        accion: 'user_create',
        entidad: 'profiles',
        entidad_id: uid,
        despues: { email, rol, permisos },
      });
      return json({ ok: true, user: { id: uid, email } });
    }

    // ── Qué secretos globales del proyecto respaldan al super admin ────────
    // Solo se informa si existen; el valor nunca sale de la función.
    if (body?.action === 'global_status') {
      return json({ ok: true, google_places: Boolean(Deno.env.get('GOOGLE_PLACES_API_KEY')) });
    }

    // ── Restablecer contraseña ────────────────────────────────────────────
    if (body?.action === 'reset_password') {
      const userId = String(body.user_id ?? '');
      const password = String(body.password ?? '');
      if (!userId) return json({ error: 'Falta user_id.' }, 400);
      if (password.length < MIN_PASSWORD) return json({ error: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.` }, 400);

      const { error: uErr } = await admin.auth.admin.updateUserById(userId, { password });
      if (uErr) return json({ error: uErr.message }, 400);

      await admin.from('audit_log').insert({
        actor_id: caller.id,
        accion: 'user_reset_password',
        entidad: 'profiles',
        entidad_id: userId,
      });
      return json({ ok: true });
    }

    return json({ error: 'Acción desconocida.' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const noAuth = /No autorizado/.test(msg);
    return json({ error: msg }, noAuth ? 401 : 500);
  }
});
