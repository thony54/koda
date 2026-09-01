-- ============================================================================
-- KODA · 0004_cron.sql  (PLANTILLA — reemplazá los <PLACEHOLDERS>)
-- Programa el pipeline con pg_cron + pg_net (sección 7.6).
--
-- ⚠️ Este archivo contiene la SERVICE_ROLE_KEY al ejecutarse. NO lo subas al
-- repo con la clave real. Ejecutalo una vez en el SQL Editor reemplazando:
--   <PROJECT_REF>        -> el ref de tu proyecto (p.ej. keudcycnwjuneaclezjk)
--   <SERVICE_ROLE_KEY>   -> Settings → API → service_role (secreta)
--
-- Requiere las funciones ya desplegadas (ver supabase/functions/README.md).
-- ============================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Helper: invoca una Edge Function por HTTP con la service_role.
-- (pg_net hace el POST de forma asíncrona.)

-- Normalizer cada 10 minutos.
select cron.schedule('koda-normalizer', '*/10 * * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/koda-normalizer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
$$);

-- Scorer cada 10 minutos (desfasado 2 min para correr tras el normalizer).
select cron.schedule('koda-scorer', '2-59/10 * * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/koda-scorer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
$$);

-- (Fase 3) Notifier cada minuto — drena la cola de notifications a Discord.
select cron.schedule('koda-notifier', '* * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/koda-notifier',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_ROLE_KEY>'),
    body := '{}'::jsonb);
$$);

-- (Fase 3) Digest diario 07:00 America/Guayaquil = 12:00 UTC.
select cron.schedule('koda-digest', '0 12 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/koda-digest',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_ROLE_KEY>'),
    body := '{}'::jsonb);
$$);

-- Para ver / borrar tareas:
--   select * from cron.job;
--   select cron.unschedule('koda-normalizer');
