-- ============================================================================
-- KODA · 0006_multiusuario.sql
-- Convierte KODA de un solo inquilino a MULTIUSUARIO:
--   1) profiles: permisos por usuario (funciones habilitadas), tope de costo.
--   2) owner_id en prospects / search_jobs / job_runs / raw_records / tags /
--      notifications. TODO lo existente pasa al super_admin actual.
--   3) RLS por dueño: cada usuario ve y edita solo lo suyo; el super_admin ve todo.
--   4) Secretos por usuario (API key de Google Places, webhooks de Discord)
--      cifrados en Supabase Vault. El navegador NUNCA puede leerlos; solo las
--      Edge Functions (service_role) los descifran.
--   5) Estadísticas por usuario para el panel de administración.
--
-- Es idempotente: se puede volver a correr sin duplicar nada.
-- ============================================================================

-- ── 0) Pre-chequeo ──────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from public.profiles where rol = 'super_admin' and activo) then
    raise exception 'Se necesita al menos un super_admin activo: los datos existentes se asignan a él.';
  end if;
end $$;

-- ── 1) profiles: permisos + tope de costo + quién lo creó ───────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'permisos'
  ) then
    alter table public.profiles add column permisos text[] not null default '{}';
    -- Quien ya existía (analista/lector) conserva el acceso que tenía hasta hoy.
    update public.profiles
       set permisos = array['busquedas','google_places','importar','curaduria','duplicados',
                            'mapa','reportes','exportar','eliminar','discord']
     where rol <> 'super_admin';
  end if;
end $$;

alter table public.profiles add column if not exists tope_costo_mensual numeric(10,2);  -- null = valor por defecto de la función
alter table public.profiles add column if not exists creado_por uuid references public.profiles(id) on delete set null;

-- Un registro nuevo en Auth ya NO nace activo: el super_admin lo habilita al
-- crear el usuario desde el panel. Así un alta pública accidental no da acceso.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nombre, activo)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', new.email), false)
  on conflict (id) do nothing;
  return new;
end $$;

-- ── 2) Helpers de autorización ──────────────────────────────────────────────
-- ¿El usuario activo tiene esta función habilitada? (super_admin: siempre sí)
create or replace function public.has_perm(p_perm text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.activo
      and (p.rol = 'super_admin' or p_perm = any (p.permisos))
  );
$$;

-- ¿Puedo ver/tocar filas de este dueño? (el propio usuario o el super_admin)
create or replace function public.can_access_owner(p_owner uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select p_owner = auth.uid() or public.is_super_admin();
$$;

-- ── 3) owner_id en las tablas de datos ──────────────────────────────────────
-- Se agrega con DEFAULT constante = super_admin actual: Postgres lo aplica a las
-- filas existentes sin reescribir la tabla ni disparar triggers (updated_at, audit).
-- Después el default pasa a ser auth.uid() para los inserts desde el navegador.
do $$
declare
  v_admin uuid;
  t text;
begin
  select id into v_admin from public.profiles
   where rol = 'super_admin' and activo order by created_at limit 1;

  foreach t in array array['prospects','search_jobs','job_runs','raw_records','tags'] loop
    execute format(
      'alter table public.%I add column if not exists owner_id uuid not null default %L references public.profiles(id)',
      t, v_admin);
    execute format('alter table public.%I alter column owner_id set default auth.uid()', t);
  end loop;

  -- notifications: owner_id opcional (avisos de sistema sin dueño usan los webhooks globales).
  alter table public.notifications add column if not exists owner_id uuid references public.profiles(id);
  update public.notifications set owner_id = v_admin where owner_id is null;
end $$;

-- Las Edge Functions (service_role) insertan job_runs/raw_records sin sesión: el
-- dueño se hereda del job / de la ejecución, así la integridad no depende del código.
create or replace function public.inherit_owner_job_run()
returns trigger language plpgsql as $$
begin
  if new.owner_id is null then
    select owner_id into new.owner_id from public.search_jobs where id = new.job_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_job_runs_owner on public.job_runs;
create trigger trg_job_runs_owner before insert on public.job_runs
  for each row execute function public.inherit_owner_job_run();

create or replace function public.inherit_owner_raw_record()
returns trigger language plpgsql as $$
begin
  if new.owner_id is null then
    select owner_id into new.owner_id from public.job_runs where id = new.run_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_raw_records_owner on public.raw_records;
create trigger trg_raw_records_owner before insert on public.raw_records
  for each row execute function public.inherit_owner_raw_record();

-- Unicidad POR DUEÑO: dos usuarios pueden tener el mismo negocio / la misma etiqueta.
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tabla, c.conname
    from pg_constraint c
    where c.contype = 'u'
      and c.conrelid in ('public.prospects'::regclass, 'public.tags'::regclass)
      and array_length(c.conkey, 1) = 1
      and (select a.attname from pg_attribute a
            where a.attrelid = c.conrelid and a.attnum = c.conkey[1])
          in ('google_place_id', 'dedupe_hash', 'nombre')
  loop
    execute format('alter table %s drop constraint %I', r.tabla, r.conname);
  end loop;
end $$;

create unique index if not exists prospects_owner_place_key
  on public.prospects (owner_id, google_place_id) where google_place_id is not null;
create unique index if not exists prospects_owner_hash_key
  on public.prospects (owner_id, dedupe_hash) where dedupe_hash is not null;
create unique index if not exists tags_owner_nombre_key
  on public.tags (owner_id, nombre);

create index if not exists idx_prospects_owner     on public.prospects (owner_id, created_at desc);
create index if not exists idx_search_jobs_owner   on public.search_jobs (owner_id);
create index if not exists idx_job_runs_owner      on public.job_runs (owner_id, started_at desc);
create index if not exists idx_raw_records_owner   on public.raw_records (owner_id);
create index if not exists idx_notifications_owner on public.notifications (owner_id, created_at desc);

-- ¿El prospecto es mío (o soy super_admin)? Para las tablas hijas.
-- (Va después de crear owner_id: una función SQL se valida al crearse.)
create or replace function public.owns_prospect(p_prospect uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from prospects x
    where x.id = p_prospect and (x.owner_id = auth.uid() or public.is_super_admin())
  );
$$;

-- ── 4) RLS por dueño ────────────────────────────────────────────────────────
-- prospects ------------------------------------------------------------------
drop policy if exists "miembros leen prospects" on public.prospects;
drop policy if exists "staff escribe prospects" on public.prospects;
drop policy if exists "prospects: lectura" on public.prospects;
drop policy if exists "prospects: alta" on public.prospects;
drop policy if exists "prospects: edicion" on public.prospects;
drop policy if exists "prospects: baja" on public.prospects;

create policy "prospects: lectura" on public.prospects for select
  using (public.is_active_member() and public.can_access_owner(owner_id));
create policy "prospects: alta" on public.prospects for insert
  with check (public.is_staff() and public.can_access_owner(owner_id)
              and (public.has_perm('importar') or public.has_perm('curaduria')));
create policy "prospects: edicion" on public.prospects for update
  using (public.is_staff() and public.can_access_owner(owner_id))
  with check (public.is_staff() and public.can_access_owner(owner_id));
create policy "prospects: baja" on public.prospects for delete
  using (public.is_staff() and public.can_access_owner(owner_id)
         and (public.has_perm('eliminar') or public.has_perm('duplicados')));

-- tablas hijas de prospects (contacts, signals, notes, activities, prospect_tags)
do $$
declare
  t text;
  nombre_corto text;
begin
  foreach t in array array['prospect_contacts','prospect_signals','notes','activities','prospect_tags'] loop
    nombre_corto := case t
      when 'prospect_contacts' then 'contacts'
      when 'prospect_signals'  then 'signals'
      when 'prospect_tags'     then 'prospect_tags'
      else t end;

    execute format('drop policy if exists %I on public.%I', 'miembros leen ' || nombre_corto, t);
    execute format('drop policy if exists %I on public.%I', 'staff escribe ' || nombre_corto, t);
    execute format('drop policy if exists %I on public.%I', t || ': lectura', t);
    execute format('drop policy if exists %I on public.%I', t || ': escritura', t);

    execute format(
      'create policy %I on public.%I for select using (public.is_active_member() and public.owns_prospect(prospect_id))',
      t || ': lectura', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_staff() and public.owns_prospect(prospect_id)) with check (public.is_staff() and public.owns_prospect(prospect_id))',
      t || ': escritura', t);
  end loop;
end $$;

-- tags (etiquetas propias de cada usuario) -----------------------------------
drop policy if exists "miembros leen tags" on public.tags;
drop policy if exists "staff escribe tags" on public.tags;
drop policy if exists "tags: lectura" on public.tags;
drop policy if exists "tags: escritura" on public.tags;
create policy "tags: lectura" on public.tags for select
  using (public.is_active_member() and public.can_access_owner(owner_id));
create policy "tags: escritura" on public.tags for all
  using (public.is_staff() and public.can_access_owner(owner_id))
  with check (public.is_staff() and public.can_access_owner(owner_id));

-- search_jobs ----------------------------------------------------------------
drop policy if exists "miembros leen jobs" on public.search_jobs;
drop policy if exists "staff escribe jobs" on public.search_jobs;
drop policy if exists "jobs: lectura" on public.search_jobs;
drop policy if exists "jobs: escritura" on public.search_jobs;
create policy "jobs: lectura" on public.search_jobs for select
  using (public.is_active_member() and public.can_access_owner(owner_id));
create policy "jobs: escritura" on public.search_jobs for all
  using (public.is_staff() and public.has_perm('busquedas') and public.can_access_owner(owner_id))
  with check (public.is_staff() and public.has_perm('busquedas') and public.can_access_owner(owner_id));

-- job_runs / raw_records (lectura; escribe la Edge Function) -------------------
drop policy if exists "miembros leen runs" on public.job_runs;
drop policy if exists "runs: lectura" on public.job_runs;
create policy "runs: lectura" on public.job_runs for select
  using (public.is_active_member() and public.can_access_owner(owner_id));

drop policy if exists "staff lee raw" on public.raw_records;
drop policy if exists "raw: lectura" on public.raw_records;
create policy "raw: lectura" on public.raw_records for select
  using (public.is_staff() and public.can_access_owner(owner_id));

-- notifications ---------------------------------------------------------------
drop policy if exists "staff lee notifications" on public.notifications;
drop policy if exists "notifications: lectura" on public.notifications;
create policy "notifications: lectura" on public.notifications for select
  using (public.is_active_member() and public.can_access_owner(owner_id));

-- Catálogos y configuración GLOBALES: todos leen, solo el super_admin escribe ----
drop policy if exists "staff escribe sources" on public.sources;
drop policy if exists "sources: escritura admin" on public.sources;
create policy "sources: escritura admin" on public.sources for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "staff escribe scoring" on public.scoring_rules;
drop policy if exists "scoring: escritura admin" on public.scoring_rules;
create policy "scoring: escritura admin" on public.scoring_rules for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "staff escribe config" on public.app_config;
drop policy if exists "config: escritura admin" on public.app_config;
create policy "config: escritura admin" on public.app_config for all
  using (public.is_super_admin()) with check (public.is_super_admin());

-- Lista de supresión (privacidad): global; solo el super_admin la consulta.
drop policy if exists "staff lee deletion" on public.deletion_requests;
drop policy if exists "deletion: lectura admin" on public.deletion_requests;
create policy "deletion: lectura admin" on public.deletion_requests for select
  using (public.is_super_admin());

-- ── 5) Secretos por usuario (Vault) ─────────────────────────────────────────
do $$ begin
  create extension if not exists supabase_vault with schema vault;
exception when others then
  raise notice 'supabase_vault no se pudo crear aquí (%): si ya existe en tu proyecto, ignora este aviso.', sqlerrm;
end $$;

-- Metadatos de cada secreto. El valor vive CIFRADO en vault.secrets.
create table if not exists public.user_secrets (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  clave           text not null,
  vault_secret_id uuid not null,
  ultimos4        text,
  updated_at      timestamptz not null default now(),
  primary key (user_id, clave)
);
alter table public.user_secrets enable row level security;
-- Sin políticas y sin privilegios: ni anon ni authenticated tocan la tabla directo.
revoke all on public.user_secrets from anon, authenticated;

-- Guarda/actualiza un secreto PROPIO. Valida clave, permiso y formato.
create or replace function public.set_my_secret(p_clave text, p_valor text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare
  v_uid   uuid := auth.uid();
  v_valor text := btrim(coalesce(p_valor, ''));
  v_id    uuid;
begin
  if v_uid is null or not public.is_active_member() then
    raise exception 'No autorizado.';
  end if;
  if p_clave not in ('google_places_api_key','discord_webhook_hot','discord_webhook_nuevos',
                     'discord_webhook_reportes','discord_webhook_errores') then
    raise exception 'Clave no permitida: %', p_clave;
  end if;
  if p_clave = 'google_places_api_key' and not public.has_perm('google_places') then
    raise exception 'Tu usuario no tiene habilitado Google Places. Pídele al administrador que lo active.';
  end if;
  if p_clave like 'discord_webhook_%' and not public.has_perm('discord') then
    raise exception 'Tu usuario no tiene habilitado Discord. Pídele al administrador que lo active.';
  end if;
  if p_clave = 'google_places_api_key' and v_valor !~ '^[A-Za-z0-9_\-]{20,}$' then
    raise exception 'La API key de Google no tiene un formato válido.';
  end if;
  if p_clave like 'discord_webhook_%'
     and v_valor !~ '^https://(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)/api/webhooks/' then
    raise exception 'No parece un webhook de Discord (debe empezar con https://discord.com/api/webhooks/).';
  end if;

  select vault_secret_id into v_id from public.user_secrets
   where user_id = v_uid and clave = p_clave;

  if v_id is null then
    v_id := vault.create_secret(v_valor, 'koda_' || v_uid::text || '_' || p_clave, 'KODA · secreto de usuario');
    insert into public.user_secrets (user_id, clave, vault_secret_id, ultimos4)
    values (v_uid, p_clave, v_id, right(v_valor, 4));
  else
    perform vault.update_secret(v_id, v_valor);
    update public.user_secrets
       set ultimos4 = right(v_valor, 4), updated_at = now()
     where user_id = v_uid and clave = p_clave;
  end if;

  -- Auditoría: solo la clave, JAMÁS el valor.
  insert into public.audit_log (actor_id, accion, entidad, entidad_id, despues)
  values (v_uid, 'secret_set', 'user_secrets', v_uid, jsonb_build_object('clave', p_clave));
end $$;

create or replace function public.delete_my_secret(p_clave text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null or not public.is_active_member() then
    raise exception 'No autorizado.';
  end if;
  select vault_secret_id into v_id from public.user_secrets
   where user_id = v_uid and clave = p_clave;
  if v_id is null then return; end if;

  delete from public.user_secrets where user_id = v_uid and clave = p_clave;
  delete from vault.secrets where id = v_id;

  insert into public.audit_log (actor_id, accion, entidad, entidad_id, despues)
  values (v_uid, 'secret_delete', 'user_secrets', v_uid, jsonb_build_object('clave', p_clave));
end $$;

-- Qué secretos tengo configurados (solo últimos 4 caracteres, nunca el valor).
create or replace function public.my_secrets_status()
returns table (clave text, ultimos4 text, updated_at timestamptz)
language sql security definer stable set search_path = public as $$
  select s.clave, s.ultimos4, s.updated_at
  from public.user_secrets s
  where s.user_id = auth.uid();
$$;

-- Solo las Edge Functions (service_role) pueden descifrar.
create or replace function public.get_user_secrets(p_user uuid, p_claves text[])
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare
  v jsonb := '{}'::jsonb;
  r record;
begin
  for r in
    select s.clave as k, d.decrypted_secret as val
    from public.user_secrets s
    join vault.decrypted_secrets d on d.id = s.vault_secret_id
    where s.user_id = p_user and s.clave = any (p_claves)
  loop
    v := v || jsonb_build_object(r.k, r.val);
  end loop;
  return v;
end $$;

revoke all on function public.get_user_secrets(uuid, text[]) from public, anon, authenticated;
grant execute on function public.get_user_secrets(uuid, text[]) to service_role;

revoke all on function public.set_my_secret(text, text)    from public, anon;
revoke all on function public.delete_my_secret(text)       from public, anon;
revoke all on function public.my_secrets_status()          from public, anon;
grant execute on function public.set_my_secret(text, text) to authenticated;
grant execute on function public.delete_my_secret(text)    to authenticated;
grant execute on function public.my_secrets_status()       to authenticated;

-- ── 6) Estadísticas por usuario (panel de administración) ───────────────────
create or replace function public.admin_user_stats()
returns table (
  user_id        uuid,
  prospectos     bigint,
  calientes      bigint,
  busquedas      bigint,
  costo_mes      numeric,
  ultimo_acceso  timestamptz,
  tiene_google   boolean,
  tiene_discord  boolean
)
language plpgsql security definer stable set search_path = public as $$
declare
  v_hot int := coalesce((select (c.valor::text)::int from app_config c where c.clave = 'hot_threshold'), 75);
begin
  if not public.is_super_admin() then
    raise exception 'Solo el super admin puede ver estas estadísticas.';
  end if;
  return query
  select
    p.id,
    (select count(*) from prospects x where x.owner_id = p.id),
    (select count(*) from prospects x where x.owner_id = p.id and coalesce(x.score, 0) >= v_hot),
    (select count(*) from search_jobs j where j.owner_id = p.id),
    coalesce((select sum(r.costo_estimado) from job_runs r
               where r.owner_id = p.id and r.started_at >= date_trunc('month', now())), 0),
    (select u.last_sign_in_at from auth.users u where u.id = p.id),
    exists (select 1 from user_secrets s where s.user_id = p.id and s.clave = 'google_places_api_key'),
    exists (select 1 from user_secrets s where s.user_id = p.id and s.clave like 'discord_webhook_%')
  from profiles p;
end $$;

revoke all on function public.admin_user_stats() from public, anon;
grant execute on function public.admin_user_stats() to authenticated;
