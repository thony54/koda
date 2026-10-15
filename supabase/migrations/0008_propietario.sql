-- ============================================================================
-- KODA · 0008_propietario.sql
-- Jerarquía de dos niveles y aislamiento estricto entre usuarios.
--
--   PROPIETARIO (profiles.es_propietario) = la cuenta dueña de KODA (connexoec).
--     Solo ella: crea/edita usuarios, ve los datos de otros, toca la configuración
--     global (fuentes, scoring, umbral, privacidad, auditoría) y usa los secretos
--     globales del proyecto (API key de Google y webhooks de Discord).
--
--   Cualquier otra cuenta —aunque su rol sea super_admin, como la de Ema— conserva
--   TODAS las funciones (permisos) pero SOLO sobre lo suyo: sus prospectos, sus
--   búsquedas, sus claves y sus canales. Nunca ve ni toca datos ajenos.
--
-- Además cierra dos huecos de la 0005/0006:
--   · anonimizar_prospectos_antiguos() era invocable por `anon`/`authenticated`
--     (SECURITY DEFINER, afecta a TODOS los usuarios) → solo service_role/cron.
--   · prospect_tags podía enlazar una etiqueta de otro usuario.
--
-- Idempotente. Aplicar con:
--   npx supabase db query --linked -f supabase/migrations/0008_propietario.sql
-- (NUNCA `supabase db push`: 0001-0005 no están registradas.)
-- Orden: migración → desplegar funciones → push del front.
-- ============================================================================

-- ── 1) Columna + un único propietario ───────────────────────────────────────
alter table public.profiles add column if not exists es_propietario boolean not null default false;

-- El propietario es el super_admin activo más antiguo (connexoec) si aún no hay uno.
update public.profiles
   set es_propietario = true
 where id = (select id from public.profiles where rol = 'super_admin' and activo order by created_at asc limit 1)
   and not exists (select 1 from public.profiles where es_propietario);

-- Máximo UNO en toda la tabla.
create unique index if not exists profiles_un_solo_propietario
  on public.profiles (es_propietario) where es_propietario;

do $$ begin
  if not exists (select 1 from public.profiles where es_propietario and activo and rol = 'super_admin') then
    raise exception 'No quedó ningún propietario activo: abortando.';
  end if;
end $$;

-- ── 2) Helper ───────────────────────────────────────────────────────────────
create or replace function public.is_propietario()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.activo and p.es_propietario
  );
$$;

-- ── 3) La jerarquía no se toca desde la aplicación ──────────────────────────
-- Solo cambios hechos desde el servidor (migraciones, SQL directo, service_role:
-- auth.uid() es null) pueden mover el título de propietario. Desde la app nadie
-- —ni el propio propietario— puede quitárselo, degradarse, desactivarse o borrarse.
create or replace function public.guard_profiles_jerarquia()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if old.es_propietario then
      raise exception 'La cuenta propietaria no se puede eliminar.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.es_propietario then
      raise exception 'No se puede crear otra cuenta propietaria.';
    end if;
    return new;
  end if;

  if new.es_propietario is distinct from old.es_propietario then
    raise exception 'El título de propietario no se puede cambiar desde la aplicación.';
  end if;
  if old.es_propietario and (new.rol <> 'super_admin' or not new.activo) then
    raise exception 'La cuenta propietaria no puede perder su rol ni desactivarse.';
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_jerarquia on public.profiles;
create trigger trg_profiles_jerarquia
  before insert or update or delete on public.profiles
  for each row execute function public.guard_profiles_jerarquia();

-- ── 4) Perfiles: cada uno ve el suyo; solo el propietario gestiona ──────────
drop policy if exists "admin gestiona perfiles"      on public.profiles;
drop policy if exists "perfil propio o admin lee"    on public.profiles;
drop policy if exists "profiles: lectura"            on public.profiles;
drop policy if exists "profiles: gestion propietario" on public.profiles;

create policy "profiles: lectura" on public.profiles for select
  using (id = auth.uid() or public.is_propietario());
create policy "profiles: gestion propietario" on public.profiles for all
  using (public.is_propietario()) with check (public.is_propietario());

-- ── 5) Datos: dueño = tú. Solo el propietario ve los de otros ───────────────
create or replace function public.can_access_owner(p_owner uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select p_owner = auth.uid() or public.is_propietario();
$$;

create or replace function public.owns_prospect(p_prospect uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from prospects x
    where x.id = p_prospect and (x.owner_id = auth.uid() or public.is_propietario())
  );
$$;

-- Una etiqueta solo puede colgarse de prospectos del MISMO dueño.
create or replace function public.prospect_tags_mismo_dueno()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from prospects p join tags t on t.owner_id = p.owner_id
    where p.id = new.prospect_id and t.id = new.tag_id
  ) then
    raise exception 'La etiqueta y el prospecto deben ser del mismo usuario.';
  end if;
  return new;
end $$;

drop trigger if exists trg_prospect_tags_dueno on public.prospect_tags;
create trigger trg_prospect_tags_dueno
  before insert or update on public.prospect_tags
  for each row execute function public.prospect_tags_mismo_dueno();

-- ── 6) Configuración global: solo el propietario escribe ────────────────────
drop policy if exists "sources: escritura admin" on public.sources;
create policy "sources: escritura admin" on public.sources for all
  using (public.is_propietario()) with check (public.is_propietario());

drop policy if exists "scoring: escritura admin" on public.scoring_rules;
create policy "scoring: escritura admin" on public.scoring_rules for all
  using (public.is_propietario()) with check (public.is_propietario());

drop policy if exists "config: escritura admin" on public.app_config;
create policy "config: escritura admin" on public.app_config for all
  using (public.is_propietario()) with check (public.is_propietario());

-- Auditoría y lista de supresión (globales): solo el propietario las consulta.
drop policy if exists "admin lee audit" on public.audit_log;
create policy "admin lee audit" on public.audit_log for select
  using (public.is_propietario());

drop policy if exists "deletion: lectura admin" on public.deletion_requests;
create policy "deletion: lectura admin" on public.deletion_requests for select
  using (public.is_propietario());

-- ── 7) Estadísticas por usuario: solo el propietario ────────────────────────
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
  if not public.is_propietario() then
    raise exception 'Solo la cuenta propietaria puede ver estas estadísticas.';
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

-- ── 8) Retención: ya NO es invocable desde la API pública ───────────────────
-- Anonimiza prospectos de TODOS los usuarios; con `anon` expuesta en el front
-- cualquiera podía dispararla (p_dias = 0). pg_cron la ejecuta como postgres.
revoke all on function public.anonimizar_prospectos_antiguos(integer) from public, anon, authenticated;
grant execute on function public.anonimizar_prospectos_antiguos(integer) to service_role;
