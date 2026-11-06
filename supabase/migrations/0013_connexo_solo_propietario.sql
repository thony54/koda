-- 0013_connexo_solo_propietario.sql — Todo lo de Connexo es SOLO de la cuenta propietaria
--
-- Decisión del propietario (2026-11-06): el puente con Connexo Clients (envío de prospectos,
-- revisión de borradores, WhatsApp, planes) lo ve y lo usa únicamente connexoec. Antes se podía
-- delegar con el permiso `enviar_a_connexo`; ese permiso desaparece.
--   · `can_send_connexo()`  ahora es exactamente `is_propietario()`.
--   · Se quita `enviar_a_connexo` de los permisos de todos los usuarios (nadie lo tenía hoy).
--   · `connexo_envios`      su política de lectura pasa a exigir propietario explícitamente.
-- La Edge Function `koda-connexo` aplica la misma regla (403 a cualquiera que no sea el propietario).
--
-- Idempotente. Aplicar con (NO usar `db push`, ver koda-multiusuario):
--   npx supabase db query --linked -f supabase/migrations/0013_connexo_solo_propietario.sql

-- ── 1) Quién puede enviar a Connexo: solo el propietario ────────────────────
create or replace function public.can_send_connexo()
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_propietario();
$$;

-- ── 2) Nadie conserva el permiso delegable ──────────────────────────────────
update public.profiles
   set permisos = array_remove(permisos, 'enviar_a_connexo')
 where 'enviar_a_connexo' = any (permisos);

-- ── 3) Lectura del espejo de envíos: solo el propietario ────────────────────
drop policy if exists "connexo_envios: lectura" on public.connexo_envios;
create policy "connexo_envios: lectura" on public.connexo_envios for select
  using (public.is_propietario());
