-- ============================================================================
-- KODA · 0015_connexo_lotes.sql
-- Lotes de envío a Connexo + ningún negocio se contacta dos veces.
--
-- 1) LOTES. Cada vez que el propietario manda prospectos a Connexo se arma un LOTE («Lote 7 · Gimnasios
--    Quito»): un grupo con número consecutivo y nombre opcional. El lote viaja a Connexo junto con cada
--    negocio, así se controla igual de los dos lados: cuántos van, cuántos aprobados, cuántos aceptaron.
--      · connexo_lotes            el lote (número por dueño, nombre, si ya se sincronizó con Connexo)
--      · connexo_envios.lote_id   a qué lote pertenece cada envío
--    Los envíos que ya existían (la primera oleada) quedan en el «Lote 1 · Primera oleada».
--
-- 2) CERO DUPLICADOS. Hasta hoy KODA solo recordaba «este prospecto ya se envió», pero un mismo negocio
--    puede estar dos veces en la base con el mismo celular (cadenas, sucursales, OSM + Google): se le
--    habría mandado el saludo dos veces. Ahora el celular también cuenta:
--      · koda_celular_ec(texto)   celular de Ecuador en formato +5939XXXXXXXX (igual que la función de Edge)
--      · connexo_envios.whatsapp  el celular al que se envió (sobrevive aunque se borre el prospecto)
--      · prospects.connexo_estado ESPEJO del estado en Connexo para filtrar la lista sin uniones:
--            NULL / error / sin_plantilla  → todavía se puede enviar
--            cualquier otro                → ya está en Connexo (no sale como candidato)
--            'duplicado'                   → OTRO prospecto con el mismo celular ya está en Connexo
--        Lo mantienen dos triggers (nunca frenan la ingesta de búsquedas).
--
-- Requiere 0012, 0013 y 0014. Idempotente. Aplicar con (NUNCA `db push`):
--   npx supabase db query --linked -f supabase/migrations/0015_connexo_lotes.sql
-- Orden: migración → desplegar `koda-connexo` → push del front.
-- ============================================================================

do $$ begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'connexo_envios') then
    raise exception 'Aplica antes 0012 y 0013.';
  end if;
end $$;

-- ── 1) Celular de Ecuador normalizado ───────────────────────────────────────
-- Misma regla que `celularEC()` de la Edge Function: solo dígitos, sin «00» inicial, 09XXXXXXXX o 9XXXXXXXX
-- pasan a 5939XXXXXXXX; si no queda un celular de Ecuador (los fijos no reciben WhatsApp) devuelve NULL.
create or replace function public.koda_celular_ec(p text)
returns text language sql immutable parallel safe as $$
  select case when d ~ '^5939[0-9]{8}$' then '+' || d end
  from (
    select case
             when a ~ '^09[0-9]{8}$' then '593' || substr(a, 2)
             when a ~ '^9[0-9]{8}$'  then '593' || a
             else a
           end as d
    from (
      select case when left(r, 2) = '00' then substr(r, 3) else r end as a
      from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as r) s0
    ) s1
  ) s2;
$$;

-- ── 2) Lotes ────────────────────────────────────────────────────────────────
create table if not exists public.connexo_lotes (
  id              uuid primary key default uuid_generate_v4(),
  owner_id        uuid not null references public.profiles(id) on delete cascade,
  numero          integer not null,                  -- consecutivo por dueño: «Lote 7»
  nombre          text,                              -- opcional: «Gimnasios Quito»
  creado_por      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  actualizado_at  timestamptz not null default now(),
  -- Cuándo se le avisó a Connexo el número y el nombre de este lote (NULL = falta; al renombrar vuelve a NULL).
  sincronizado_at timestamptz,
  unique (owner_id, numero)
);

alter table public.connexo_lotes enable row level security;
-- Solo el propietario lee; nadie escribe desde el navegador (lo hace `koda-connexo` con service_role).
drop policy if exists "connexo_lotes: lectura" on public.connexo_lotes;
create policy "connexo_lotes: lectura" on public.connexo_lotes for select using (public.is_propietario());

alter table public.connexo_envios add column if not exists lote_id  uuid references public.connexo_lotes(id) on delete set null;
alter table public.connexo_envios add column if not exists whatsapp text;      -- +5939XXXXXXXX al que se envió
create index if not exists connexo_envios_lote_idx on public.connexo_envios (lote_id);
create index if not exists connexo_envios_wa_idx   on public.connexo_envios (whatsapp) where whatsapp is not null;

-- Crea el siguiente lote del dueño (número consecutivo, sin carreras entre dos envíos a la vez).
create or replace function public.connexo_nuevo_lote(p_owner uuid, p_nombre text, p_usuario uuid)
returns public.connexo_lotes
language plpgsql security definer set search_path = public as $$
declare v public.connexo_lotes;
begin
  perform pg_advisory_xact_lock(hashtext('connexo_nuevo_lote'));
  insert into public.connexo_lotes (owner_id, numero, nombre, creado_por)
  values (
    p_owner,
    coalesce((select max(l.numero) from public.connexo_lotes l where l.owner_id = p_owner), 0) + 1,
    nullif(left(btrim(coalesce(p_nombre, '')), 80), ''),
    p_usuario
  )
  returning * into v;
  return v;
end $$;

revoke all on function public.connexo_nuevo_lote(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.connexo_nuevo_lote(uuid, text, uuid) to service_role;

-- ── 3) Datos que ya existen ─────────────────────────────────────────────────
-- 3a) El celular de cada envío, desde su prospecto.
update public.connexo_envios e
   set whatsapp = public.koda_celular_ec(p.whatsapp)
  from public.prospects p
 where p.id = e.prospect_id and e.whatsapp is null;

-- 3b) Todo lo enviado antes de existir los lotes forma el «Lote 1 · Primera oleada» del propietario.
do $$
declare
  v_prop uuid;
  v_lote uuid;
begin
  select id into v_prop from public.profiles where es_propietario limit 1;
  if v_prop is not null
     and exists (select 1 from public.connexo_envios where lote_id is null)
     and not exists (select 1 from public.connexo_lotes where owner_id = v_prop) then
    insert into public.connexo_lotes (owner_id, numero, nombre, creado_por, created_at)
    values (v_prop, 1, 'Primera oleada', v_prop, (select min(enviado_at) from public.connexo_envios))
    returning id into v_lote;
    update public.connexo_envios set lote_id = v_lote where lote_id is null;
  end if;
end $$;

-- ── 4) Espejo del estado en Connexo dentro de cada prospecto ────────────────
alter table public.prospects add column if not exists connexo_estado text;
create index if not exists idx_prospects_owner_connexo on public.prospects (owner_id, connexo_estado);
create index if not exists idx_prospects_celular_ec    on public.prospects (public.koda_celular_ec(whatsapp));

-- Estado que le toca a un prospecto: el de su propio envío (si ya cuenta como enviado), si no «duplicado» cuando
-- OTRO prospecto del mismo dueño con su mismo celular ya está en Connexo, y si no el de su envío fallido / sin plantilla.
create or replace function public.connexo_estado_de(p_prospect uuid, p_owner uuid, p_whatsapp text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select e.estado from public.connexo_envios e
      where e.prospect_id = p_prospect and e.estado not in ('error', 'sin_plantilla') limit 1),
    (select 'duplicado' from public.connexo_envios e
      where p_whatsapp is not null
        and e.owner_id = p_owner
        and e.whatsapp = public.koda_celular_ec(p_whatsapp)
        and e.prospect_id is distinct from p_prospect
        and e.estado not in ('error', 'sin_plantilla') limit 1),
    (select e.estado from public.connexo_envios e where e.prospect_id = p_prospect limit 1)
  );
$$;

-- Cuando cambia un envío se recalculan su prospecto y los que comparten su celular.
create or replace function public.trg_connexo_envios_espejo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[] := '{}';
  v_was text[] := '{}';
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if old.prospect_id is not null then v_ids := v_ids || old.prospect_id; end if;
    if old.whatsapp    is not null then v_was := v_was || old.whatsapp;    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.prospect_id is not null then v_ids := v_ids || new.prospect_id; end if;
    if new.whatsapp    is not null then v_was := v_was || new.whatsapp;    end if;
  end if;
  if cardinality(v_ids) = 0 and cardinality(v_was) = 0 then return null; end if;

  update public.prospects p
     set connexo_estado = public.connexo_estado_de(p.id, p.owner_id, p.whatsapp)
   where (p.id = any (v_ids) or public.koda_celular_ec(p.whatsapp) = any (v_was))
     and p.connexo_estado is distinct from public.connexo_estado_de(p.id, p.owner_id, p.whatsapp);
  return null;
end $$;

drop trigger if exists trg_connexo_envios_espejo on public.connexo_envios;
create trigger trg_connexo_envios_espejo
  after insert or update of estado, whatsapp, prospect_id or delete on public.connexo_envios
  for each row execute function public.trg_connexo_envios_espejo();

-- Un prospecto nuevo (o con otro celular) nace ya marcado si su celular ya está en Connexo. JAMÁS frena la ingesta.
create or replace function public.trg_prospects_connexo_estado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    new.connexo_estado := public.connexo_estado_de(new.id, new.owner_id, new.whatsapp);
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists trg_prospects_connexo on public.prospects;
create trigger trg_prospects_connexo
  before insert or update of whatsapp on public.prospects
  for each row execute function public.trg_prospects_connexo_estado();

-- 4b) Espejo de lo que ya hay.
update public.prospects p
   set connexo_estado = public.connexo_estado_de(p.id, p.owner_id, p.whatsapp)
 where p.owner_id in (select distinct owner_id from public.connexo_envios)
   and p.connexo_estado is distinct from public.connexo_estado_de(p.id, p.owner_id, p.whatsapp);
