-- 0012_connexo_puente.sql — Puente KODA → Connexo Clients
--
-- Qué hace: permite enviar prospectos a Connexo Clients, donde un agente arma un perfil
-- borrador por nicho que se revisa y se ofrece por WhatsApp (prueba de 7 días).
-- Esta migración solo prepara el LADO KODA:
--   · `can_send_connexo()`  quién puede enviar: el propietario, o quien él habilite con el
--                           permiso `enviar_a_connexo` (un super_admin que no es propietario
--                           NO lo tiene por defecto: usa el WhatsApp y el tope de Connexo).
--   · `connexo_envios`      copia local del estado de cada envío. La verdad vive en Connexo;
--                           esto es un espejo para listar sin llamar al otro proyecto.
-- El navegador solo LEE esta tabla; escribe únicamente la Edge Function `koda-connexo`
-- (service_role), que es la que habla con el puente de Connexo.
--
-- Idempotente. Aplicar con (NO usar `db push`, ver koda-multiusuario):
--   npx supabase db query --linked -f supabase/migrations/0012_connexo_puente.sql

-- ── 1) Quién puede enviar a Connexo ─────────────────────────────────────────
create or replace function public.can_send_connexo()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.activo
      and (p.es_propietario or 'enviar_a_connexo' = any (p.permisos))
  );
$$;

-- ── 2) Espejo local de los envíos ───────────────────────────────────────────
create table if not exists public.connexo_envios (
  id               uuid primary key default uuid_generate_v4(),
  owner_id         uuid not null references public.profiles(id) on delete cascade,
  prospect_id      uuid references public.prospects(id) on delete set null,
  -- Foto del prospecto: la lista sigue legible aunque el prospecto se borre o se anonimice.
  prospect_nombre  text not null,
  prospect_ciudad  text,
  categoria        text,
  rubro            text,
  -- Búsqueda que lo trajo (la más reciente), para agrupar la revisión por búsqueda.
  job_id           uuid references public.search_jobs(id) on delete set null,
  busqueda_nombre  text,
  -- Ciclo de vida (lo informa Connexo):
  --   pendiente     KODA lo registró y aún no hay respuesta del puente
  --   borrador      perfil armado, esperando que lo apruebes
  --   aprobado      aprobado, listo para el WhatsApp
  --   wa_enviado    WhatsApp enviado, esperando respuesta (sin respuesta caduca a los 7 días)
  --   aceptado      el negocio aceptó y recibió sus credenciales: aquí corre la prueba de 7 días
  --   declinado     respondió "quizás después"
  --   vencido       la invitación caducó sin respuesta, o la prueba terminó y el perfil se desactivó
  --   descartado    lo descartaste
  --   sin_plantilla su rubro todavía no tiene plantilla en Connexo
  --   error         el puente falló (ver `detalle`); se puede reintentar
  estado           text not null default 'pendiente'
                   check (estado in ('pendiente','borrador','aprobado','wa_enviado','aceptado',
                                     'declinado','vencido','descartado','sin_plantilla','error')),
  detalle          text,
  connexo_profile_id uuid,
  connexo_username text,
  connexo_theme    text,
  enviado_por      uuid references public.profiles(id) on delete set null,
  enviado_at       timestamptz not null default now(),
  actualizado_at   timestamptz not null default now()
);

-- Un prospecto se envía una sola vez; reintentar tras un error reutiliza la misma fila.
create unique index if not exists connexo_envios_prospect_uidx
  on public.connexo_envios (prospect_id) where prospect_id is not null;
create index if not exists connexo_envios_owner_idx  on public.connexo_envios (owner_id, enviado_at desc);
create index if not exists connexo_envios_estado_idx on public.connexo_envios (estado);
create index if not exists connexo_envios_job_idx    on public.connexo_envios (job_id);

alter table public.connexo_envios enable row level security;

-- Lectura: quien puede enviar, sobre lo suyo (el propietario también ve lo de otros dueños).
-- Sin políticas de escritura: INSERT/UPDATE/DELETE quedan denegados al navegador.
drop policy if exists "connexo_envios: lectura" on public.connexo_envios;
create policy "connexo_envios: lectura" on public.connexo_envios for select
  using (public.can_send_connexo() and public.can_access_owner(owner_id));
