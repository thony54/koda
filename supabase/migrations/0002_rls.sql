-- ============================================================================
-- KODA · 0002_rls.sql
-- Row Level Security en todas las tablas (sección 5.8).
--
-- Las Edge Functions usan la service_role key, que SALTA RLS por completo
-- (sección 5.8 / 4.3). Estas políticas solo gobiernan el acceso desde el
-- navegador con la ANON key.
--
-- Helpers SECURITY DEFINER: leen `profiles` saltándose su propia RLS. Esto
-- evita la recursión infinita que ocurre cuando una política SOBRE profiles
-- consulta profiles.
-- ============================================================================

create or replace function public.is_active_member()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles p where p.id = auth.uid() and p.activo
  );
$$;

create or replace function public.is_staff()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.activo and p.rol in ('super_admin', 'analista')
  );
$$;

create or replace function public.is_super_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.activo and p.rol = 'super_admin'
  );
$$;

-- ── Habilitar RLS en todas las tablas ───────────────────────────────────────
alter table profiles           enable row level security;
alter table sources            enable row level security;
alter table search_jobs        enable row level security;
alter table job_runs           enable row level security;
alter table raw_records        enable row level security;
alter table prospects          enable row level security;
alter table prospect_contacts  enable row level security;
alter table prospect_signals   enable row level security;
alter table notes              enable row level security;
alter table tags               enable row level security;
alter table prospect_tags      enable row level security;
alter table activities         enable row level security;
alter table scoring_rules      enable row level security;
alter table notifications      enable row level security;
alter table deletion_requests  enable row level security;
alter table audit_log          enable row level security;

-- ── profiles ────────────────────────────────────────────────────────────────
-- Cada quien ve su propio perfil; el Super Admin ve y gestiona todos.
drop policy if exists "perfil propio o admin lee" on profiles;
create policy "perfil propio o admin lee" on profiles
  for select using (id = auth.uid() or public.is_super_admin());

drop policy if exists "admin gestiona perfiles" on profiles;
create policy "admin gestiona perfiles" on profiles
  for all using (public.is_super_admin()) with check (public.is_super_admin());

-- ── Patrón general: miembros activos leen, staff escribe ────────────────────
-- prospects
drop policy if exists "miembros leen prospects" on prospects;
create policy "miembros leen prospects" on prospects
  for select using (public.is_active_member());
drop policy if exists "staff escribe prospects" on prospects;
create policy "staff escribe prospects" on prospects
  for all using (public.is_staff()) with check (public.is_staff());

-- prospect_contacts
drop policy if exists "miembros leen contacts" on prospect_contacts;
create policy "miembros leen contacts" on prospect_contacts
  for select using (public.is_active_member());
drop policy if exists "staff escribe contacts" on prospect_contacts;
create policy "staff escribe contacts" on prospect_contacts
  for all using (public.is_staff()) with check (public.is_staff());

-- prospect_signals
drop policy if exists "miembros leen signals" on prospect_signals;
create policy "miembros leen signals" on prospect_signals
  for select using (public.is_active_member());
drop policy if exists "staff escribe signals" on prospect_signals;
create policy "staff escribe signals" on prospect_signals
  for all using (public.is_staff()) with check (public.is_staff());

-- notes  (autor debe ser el usuario; todos los activos leen)
drop policy if exists "miembros leen notes" on notes;
create policy "miembros leen notes" on notes
  for select using (public.is_active_member());
drop policy if exists "staff escribe notes" on notes;
create policy "staff escribe notes" on notes
  for all using (public.is_staff()) with check (public.is_staff());

-- tags
drop policy if exists "miembros leen tags" on tags;
create policy "miembros leen tags" on tags
  for select using (public.is_active_member());
drop policy if exists "staff escribe tags" on tags;
create policy "staff escribe tags" on tags
  for all using (public.is_staff()) with check (public.is_staff());

-- prospect_tags
drop policy if exists "miembros leen prospect_tags" on prospect_tags;
create policy "miembros leen prospect_tags" on prospect_tags
  for select using (public.is_active_member());
drop policy if exists "staff escribe prospect_tags" on prospect_tags;
create policy "staff escribe prospect_tags" on prospect_tags
  for all using (public.is_staff()) with check (public.is_staff());

-- activities
drop policy if exists "miembros leen activities" on activities;
create policy "miembros leen activities" on activities
  for select using (public.is_active_member());
drop policy if exists "staff escribe activities" on activities;
create policy "staff escribe activities" on activities
  for all using (public.is_staff()) with check (public.is_staff());

-- sources
drop policy if exists "miembros leen sources" on sources;
create policy "miembros leen sources" on sources
  for select using (public.is_active_member());
drop policy if exists "staff escribe sources" on sources;
create policy "staff escribe sources" on sources
  for all using (public.is_staff()) with check (public.is_staff());

-- search_jobs
drop policy if exists "miembros leen jobs" on search_jobs;
create policy "miembros leen jobs" on search_jobs
  for select using (public.is_active_member());
drop policy if exists "staff escribe jobs" on search_jobs;
create policy "staff escribe jobs" on search_jobs
  for all using (public.is_staff()) with check (public.is_staff());

-- job_runs  (lectura; la escritura la hace la Edge Function con service_role)
drop policy if exists "miembros leen runs" on job_runs;
create policy "miembros leen runs" on job_runs
  for select using (public.is_active_member());

-- raw_records (solo staff lee el crudo; escritura vía service_role)
drop policy if exists "staff lee raw" on raw_records;
create policy "staff lee raw" on raw_records
  for select using (public.is_staff());

-- scoring_rules  (staff gestiona desde el panel)
drop policy if exists "miembros leen scoring" on scoring_rules;
create policy "miembros leen scoring" on scoring_rules
  for select using (public.is_active_member());
drop policy if exists "staff escribe scoring" on scoring_rules;
create policy "staff escribe scoring" on scoring_rules
  for all using (public.is_staff()) with check (public.is_staff());

-- notifications  (staff lee; el envío/creación lo hace service_role)
drop policy if exists "staff lee notifications" on notifications;
create policy "staff lee notifications" on notifications
  for select using (public.is_staff());

-- deletion_requests  (derecho de supresión; staff lo consulta y crea)
drop policy if exists "staff lee deletion" on deletion_requests;
create policy "staff lee deletion" on deletion_requests
  for select using (public.is_staff());
drop policy if exists "staff crea deletion" on deletion_requests;
create policy "staff crea deletion" on deletion_requests
  for insert with check (public.is_staff());

-- audit_log  (solo Super Admin lee; escritura vía service_role/triggers)
drop policy if exists "admin lee audit" on audit_log;
create policy "admin lee audit" on audit_log
  for select using (public.is_super_admin());
