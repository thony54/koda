-- ============================================================================
-- KODA · 0001_schema.sql
-- Esquema base (sección 5 del documento técnico).
-- Orden: extensiones → enums → funciones base → tablas → índices → triggers.
-- RLS va aparte en 0002_rls.sql.
-- ============================================================================

-- ── Extensiones ─────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;      -- búsqueda difusa y dedupe
create extension if not exists unaccent;     -- (añadido) requerido por nombre_normalizado
create extension if not exists pg_cron;
create extension if not exists postgis;      -- opcional, para radio de búsqueda

-- Wrapper IMMUTABLE de unaccent.
-- El doc usa `unaccent(nombre)` en una columna GENERATED STORED, pero la
-- función unaccent() es STABLE (depende del diccionario) y Postgres NO permite
-- funciones no-inmutables en columnas generadas. Este wrapper la marca
-- IMMUTABLE de forma segura para poder indexar y generar.
create or replace function public.immutable_unaccent(text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select unaccent('unaccent', $1)
$$;

-- ── Enums ───────────────────────────────────────────────────────────────────
do $$ begin
  create type prospect_type as enum (
    'negocio_local', 'emprendimiento', 'empresa',
    'profesional_independiente', 'creador_contenido', 'organizacion'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type prospect_status as enum (
    'nuevo', 'calificado', 'en_contacto', 'interesado',
    'negociacion', 'cliente', 'descartado', 'no_contactar'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type job_status as enum ('pendiente', 'corriendo', 'ok', 'error', 'cancelado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_role as enum ('super_admin', 'analista', 'lector');
exception when duplicate_object then null; end $$;

-- ── Usuarios ────────────────────────────────────────────────────────────────
create table if not exists profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text not null,
  nombre      text,
  rol         user_role not null default 'lector',
  activo      boolean not null default true,
  created_at  timestamptz default now()
);

-- ── Fuentes y trabajos de búsqueda ──────────────────────────────────────────
create table if not exists sources (
  id          uuid primary key default uuid_generate_v4(),
  nombre      text not null,
  tipo        text not null,                  -- 'api' | 'scraper' | 'manual' | 'csv'
  base_url    text,
  activo      boolean default true,
  rate_limit_por_min int default 60,
  config      jsonb default '{}'::jsonb,
  created_at  timestamptz default now()
);

create table if not exists search_jobs (
  id            uuid primary key default uuid_generate_v4(),
  nombre        text not null,
  source_id     uuid references sources(id),
  query         text not null,
  ciudad        text,
  provincia     text,
  pais          text default 'EC',
  lat           double precision,
  lng           double precision,
  radio_metros  int default 15000,
  categorias    text[],
  cron          text,
  activo        boolean default true,
  max_resultados int default 60,
  created_by    uuid references profiles(id),
  created_at    timestamptz default now(),
  last_run_at   timestamptz
);

create table if not exists job_runs (
  id              uuid primary key default uuid_generate_v4(),
  job_id          uuid references search_jobs(id) on delete cascade,
  status          job_status default 'pendiente',
  started_at      timestamptz default now(),
  finished_at     timestamptz,
  encontrados     int default 0,
  nuevos          int default 0,
  duplicados      int default 0,
  error_mensaje   text,
  costo_estimado  numeric(10,4) default 0
);

create table if not exists raw_records (
  id          uuid primary key default uuid_generate_v4(),
  run_id      uuid references job_runs(id) on delete cascade,
  source_id   uuid references sources(id),
  external_id text,
  payload     jsonb not null,
  procesado   boolean default false,
  created_at  timestamptz default now()
);

-- ── Prospectos (tabla central) ──────────────────────────────────────────────
create table if not exists prospects (
  id                uuid primary key default uuid_generate_v4(),

  -- identidad
  nombre            text not null,
  nombre_normalizado text generated always as (lower(public.immutable_unaccent(nombre))) stored,
  tipo              prospect_type not null default 'negocio_local',
  categoria         text,
  descripcion       text,

  -- ubicación
  direccion         text,
  ciudad            text,
  provincia         text,
  pais              text default 'EC',
  lat               double precision,
  lng               double precision,

  -- presencia digital
  website           text,
  tiene_website     boolean default false,
  usa_linktree      boolean default false,
  instagram         text,
  facebook          text,
  tiktok            text,
  whatsapp          text,
  google_place_id   text unique,
  google_maps_url   text,

  -- actividad
  rating            numeric(2,1),
  reviews_count     int,

  -- calificación
  score             int default 0,
  score_desglose    jsonb default '{}'::jsonb,
  plan_sugerido     text,
  status            prospect_status default 'nuevo',
  opt_out           boolean default false,

  -- trazabilidad y asignación
  source_id         uuid references sources(id),
  source_url        text,
  first_seen_at     timestamptz default now(),
  last_seen_at      timestamptz default now(),
  verified_by       uuid references profiles(id),
  verified_at       timestamptz,
  assigned_to       text,
  ong_referente     text,

  -- deduplicación
  dedupe_hash       text unique,

  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create table if not exists prospect_contacts (
  id          uuid primary key default uuid_generate_v4(),
  prospect_id uuid references prospects(id) on delete cascade,
  tipo        text not null,                   -- 'telefono' | 'email' | 'whatsapp' | 'formulario'
  valor       text not null,
  etiqueta    text,
  verificado  boolean default false,
  created_at  timestamptz default now()
);

create table if not exists prospect_signals (
  id          uuid primary key default uuid_generate_v4(),
  prospect_id uuid references prospects(id) on delete cascade,
  clave       text not null,
  valor       text,
  peso        int default 0,
  detectado_at timestamptz default now()
);

create table if not exists notes (
  id          uuid primary key default uuid_generate_v4(),
  prospect_id uuid references prospects(id) on delete cascade,
  autor_id    uuid references profiles(id),
  texto       text not null,
  created_at  timestamptz default now()
);

create table if not exists tags (
  id     uuid primary key default uuid_generate_v4(),
  nombre text unique not null,
  color  text default '#888888'
);

create table if not exists prospect_tags (
  prospect_id uuid references prospects(id) on delete cascade,
  tag_id      uuid references tags(id) on delete cascade,
  primary key (prospect_id, tag_id)
);

create table if not exists activities (
  id          uuid primary key default uuid_generate_v4(),
  prospect_id uuid references prospects(id) on delete cascade,
  autor_id    uuid references profiles(id),
  tipo        text not null,
  detalle     jsonb,
  created_at  timestamptz default now()
);

-- ── Scoring, notificaciones, cumplimiento ───────────────────────────────────
create table if not exists scoring_rules (
  id          uuid primary key default uuid_generate_v4(),
  clave       text unique not null,
  descripcion text not null,
  puntos      int not null,
  activa      boolean default true,
  orden       int default 0
);

create table if not exists notifications (
  id           uuid primary key default uuid_generate_v4(),
  prospect_id  uuid references prospects(id) on delete set null,
  canal        text not null,                  -- 'hot' | 'nuevos' | 'reportes' | 'errores'
  payload      jsonb,
  status       text default 'pendiente',       -- 'pendiente' | 'enviado' | 'error'
  intento      int default 0,
  error_mensaje text,
  enviado_at   timestamptz,
  created_at   timestamptz default now()
);

create table if not exists deletion_requests (
  id            uuid primary key default uuid_generate_v4(),
  prospect_hash text not null,                 -- dedupe_hash del eliminado
  motivo        text,
  solicitado_por text,
  created_at    timestamptz default now()
);

create table if not exists audit_log (
  id         uuid primary key default uuid_generate_v4(),
  actor_id   uuid references profiles(id),
  accion     text not null,
  entidad    text,
  entidad_id uuid,
  antes      jsonb,
  despues    jsonb,
  created_at timestamptz default now()
);

-- ── Índices (sección 5.6) ───────────────────────────────────────────────────
create index if not exists idx_prospects_nombre_norm
  on prospects using gin (nombre_normalizado gin_trgm_ops);
create index if not exists idx_prospects_ciudad_status on prospects (ciudad, status);
create index if not exists idx_prospects_score on prospects (score desc);
create index if not exists idx_prospects_tipo_categoria on prospects (tipo, categoria);
create index if not exists idx_prospects_created on prospects (created_at desc);
create index if not exists idx_contacts_prospect on prospect_contacts (prospect_id);
create index if not exists idx_raw_unprocessed on raw_records (run_id) where procesado = false;
create index if not exists idx_notif_pending on notifications (status) where status = 'pendiente';

-- ── Triggers ────────────────────────────────────────────────────────────────

-- updated_at automático en prospects.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_prospects_updated on prospects;
create trigger trg_prospects_updated
  before update on prospects
  for each row execute function public.set_updated_at();

-- Crea la fila en profiles al registrarse un usuario (sección 9),
-- con rol 'lector' por defecto. El Super Admin promueve después.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nombre)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
