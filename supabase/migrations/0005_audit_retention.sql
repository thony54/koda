-- ============================================================================
-- KODA · 0005_audit_retention.sql  (Fase 3)
-- 1) app_config: configuración editable desde el panel (umbral caliente, etc.)
-- 2) Auditoría automática: triggers que llenan audit_log en cada cambio.
-- 3) Retención: anonimiza prospectos antiguos (decisión del usuario: 365 días,
--    anonimizar en vez de borrar). Programado con pg_cron (SQL puro, sin secretos).
-- ============================================================================

-- ── 1) Configuración de la app ──────────────────────────────────────────────
create table if not exists app_config (
  clave       text primary key,
  valor       jsonb not null,
  descripcion text,
  updated_at  timestamptz default now()
);

insert into app_config (clave, valor, descripcion) values
  ('hot_threshold', '75'::jsonb, 'Score mínimo para considerar un prospecto CALIENTE y avisar a Discord.'),
  ('retencion_dias', '365'::jsonb, 'Días sin ser visto tras los cuales un prospecto se anonimiza.')
on conflict (clave) do nothing;

alter table app_config enable row level security;
drop policy if exists "miembros leen config" on app_config;
create policy "miembros leen config" on app_config
  for select using (public.is_active_member());
drop policy if exists "staff escribe config" on app_config;
create policy "staff escribe config" on app_config
  for all using (public.is_staff()) with check (public.is_staff());

-- ── 2) Auditoría automática ─────────────────────────────────────────────────
-- Una sola función genérica registra INSERT / UPDATE / DELETE en audit_log.
-- actor_id = usuario autenticado (null si lo hizo una Edge Function/cron).
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  -- Solo auditamos acciones de un usuario autenticado. Las escrituras de las
  -- Edge Functions / cron (service_role, auth.uid() null) generan muchísimo
  -- ruido durante la ingesta y no aportan a la auditoría de personas.
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_id := coalesce((case when tg_op = 'DELETE' then old.id else new.id end), null);
  insert into audit_log (actor_id, accion, entidad, entidad_id, antes, despues)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    v_id,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- Adjunta el trigger a las tablas relevantes (idempotente).
do $$
declare t text;
begin
  foreach t in array array['prospects','search_jobs','sources','scoring_rules','profiles'] loop
    execute format('drop trigger if exists trg_audit on public.%I;', t);
    execute format(
      'create trigger trg_audit after insert or update or delete on public.%I
         for each row execute function public.audit_trigger();', t);
  end loop;
end $$;

-- ── 3) Retención: anonimizar prospectos antiguos ────────────────────────────
-- Marca de anonimización en prospects.
alter table prospects add column if not exists anonimizado    boolean default false;
alter table prospects add column if not exists anonimizado_at timestamptz;

-- Anonimiza (no borra) los prospectos sin actividad reciente: elimina datos de
-- contacto y presencia digital, conserva la fila para estadísticas/histórico.
create or replace function public.anonimizar_prospectos_antiguos(p_dias int default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_dias int;
  v_ids  uuid[];
begin
  v_dias := coalesce(
    p_dias,
    (select (valor::text)::int from app_config where clave = 'retencion_dias'),
    365
  );

  select array_agg(id) into v_ids
  from prospects
  where anonimizado = false
    and coalesce(last_seen_at, first_seen_at, created_at) < now() - make_interval(days => v_dias)
    -- Nunca anonimizar prospectos que ya son clientes o están en gestión activa.
    and status not in ('cliente','interesado','negociacion','en_contacto');

  if v_ids is null then return 0; end if;

  -- Borrar datos de contacto asociados.
  delete from prospect_contacts where prospect_id = any(v_ids);

  update prospects set
    whatsapp        = null,
    instagram       = null,
    facebook        = null,
    tiktok          = null,
    website         = null,
    tiene_website   = false,
    usa_linktree    = false,
    google_maps_url = null,
    direccion       = null,
    descripcion     = null,
    anonimizado     = true,
    anonimizado_at  = now()
  where id = any(v_ids);

  return array_length(v_ids, 1);
end $$;

-- Programa la retención: todos los días a las 08:00 UTC (03:00 Guayaquil).
-- Es SQL puro (no llama Edge Functions), así que NO necesita la service_role key.
do $$ begin
  perform cron.unschedule('koda-retencion');
exception when others then null; end $$;
select cron.schedule('koda-retencion', '0 8 * * *', $$ select public.anonimizar_prospectos_antiguos(); $$);
