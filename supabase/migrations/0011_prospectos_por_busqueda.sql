-- ============================================================================
-- KODA · 0011_prospectos_por_busqueda.sql
-- Cada prospecto recuerda de QUÉ búsquedas salió, para poder filtrar la lista de
-- Prospectos por búsqueda ("solo la última", "las de hoy", "solo los nuevos de X").
--
-- Hasta ahora el prospecto solo guardaba la FUENTE (OSM / Google), no la búsqueda
-- ni la corrida que lo trajo. `prospect_runs` registra, por cada corrida del collector,
-- cada prospecto que encontró: los NUEVOS (nuevo = true) y también los que ya existían
-- y la búsqueda volvió a ver (nuevo = false). Una búsqueda y otra pueden compartir
-- prospectos, por eso es una tabla de unión y no una columna.
--
-- Historial: las corridas anteriores no guardaron esto, así que se reconstruye con los
-- registros crudos que cada corrida dejó (ver más abajo). Desde ahora se registra todo.
--
-- Requiere 0006 (owner_id). Idempotente. Aplicar con:
--   npx supabase db query --linked -f supabase/migrations/0011_prospectos_por_busqueda.sql
-- (NUNCA `supabase db push`.)  Orden: migración → desplegar koda-normalizer → push del front.
-- ============================================================================

create table if not exists public.prospect_runs (
  prospect_id uuid not null references public.prospects(id)  on delete cascade,
  run_id      uuid not null references public.job_runs(id)   on delete cascade,
  job_id      uuid          references public.search_jobs(id) on delete cascade,
  owner_id    uuid not null references public.profiles(id)   on delete cascade,
  nuevo       boolean not null default false,        -- ¿esta corrida lo creó?
  found_at    timestamptz not null default now(),
  primary key (prospect_id, run_id)
);

create index if not exists idx_prospect_runs_job   on public.prospect_runs (job_id);
create index if not exists idx_prospect_runs_run   on public.prospect_runs (run_id);
create index if not exists idx_prospect_runs_owner on public.prospect_runs (owner_id, found_at desc);

-- Solo se LEE desde el navegador (cada quien lo suyo; el propietario, todo). Escribe el
-- normalizer con service_role, que se salta RLS.
alter table public.prospect_runs enable row level security;
drop policy if exists "prospect_runs: lectura" on public.prospect_runs;
create policy "prospect_runs: lectura" on public.prospect_runs for select
  using (public.is_active_member() and public.can_access_owner(owner_id));

-- ── Historial ───────────────────────────────────────────────────────────────
-- Se reconstruye con los registros crudos (raw_records) que cada corrida dejó: un prospecto
-- "salió de" una corrida si su nombre aparece en lo que esa corrida recolectó (mismo dueño,
-- ignorando mayúsculas, tildes y espacios) y ya existía cuando la corrida terminó de
-- procesarse. Así se recupera también lo que una búsqueda volvió a encontrar.
-- `nuevo` = la PRIMERA corrida que lo recolectó, si el prospecto nació con ella.
-- En corridas que se solapaban en el tiempo esto es una aproximación.
with candidatos as (
  select p.id as prospect_id, r.id as run_id, r.job_id, p.owner_id,
         p.first_seen_at, r.started_at, r.finished_at,
         min(rr.created_at) as recolectado_at
    from public.raw_records rr
    join public.job_runs r on r.id = rr.run_id
    join public.prospects p
      on p.owner_id = rr.owner_id
     and lower(public.immutable_unaccent(regexp_replace(btrim(p.nombre), '\s+', ' ', 'g')))
       = lower(public.immutable_unaccent(regexp_replace(
           btrim(coalesce(rr.payload->'tags'->>'name', rr.payload->'tags'->>'name:es', rr.payload->'displayName'->>'text')),
           '\s+', ' ', 'g')))
   where p.first_seen_at <= coalesce(r.finished_at, r.started_at) + interval '3 hours'
   group by p.id, r.id
), ordenados as (
  select c.*,
         row_number() over (partition by c.prospect_id order by c.recolectado_at asc) as orden
    from candidatos c
)
insert into public.prospect_runs (prospect_id, run_id, job_id, owner_id, nuevo, found_at)
select o.prospect_id, o.run_id, o.job_id, o.owner_id,
       (o.orden = 1 and o.first_seen_at >= o.started_at - interval '1 minute'),
       case when o.orden = 1 and o.first_seen_at >= o.started_at - interval '1 minute'
            then o.first_seen_at else coalesce(o.finished_at, o.started_at) end
  from ordenados o
on conflict do nothing;
