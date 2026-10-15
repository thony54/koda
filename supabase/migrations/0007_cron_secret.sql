-- ============================================================================
-- KODA · 0007_cron_secret.sql
-- Re-agenda los 4 cron para que lleguen a las Edge Functions SIN embeber ninguna
-- clave en `cron.job`. Reemplaza lo que dejó la plantilla 0004 (que ya no se usa).
--
-- Cómo funciona: pg_cron llama a `public.koda_cron_call(<función>)`, que lee el
-- secreto `cron_secret` de Supabase Vault y hace el POST con la cabecera
-- `x-cron-secret`. Las funciones (verify_jwt = false, ver supabase/config.toml) lo
-- validan en `requireCaller` contra el secret `CRON_SECRET` de las Edge Functions.
--
-- ⚠️ El valor del secreto NO está en este archivo. Se crea una sola vez, a mano:
--     1) generar uno:           openssl rand -hex 32
--     2) Edge Functions:        supabase secrets set CRON_SECRET=<valor>
--     3) Vault (misma cadena):  select vault.create_secret('<valor>', 'cron_secret',
--                                 'Secreto compartido pg_cron -> Edge Functions KODA');
--     Rotarlo: vault.update_secret(<id>, '<nuevo>') + secrets set con el mismo valor.
--
-- Aplicar con:  npx supabase db query --linked -f supabase/migrations/0007_cron_secret.sql
-- (NUNCA `supabase db push`: 0001-0005 no están registradas.) Idempotente.
-- ============================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Invoca una Edge Function de KODA con el secreto de cron. Devuelve el id de la
-- petición de pg_net (la respuesta queda en net._http_response).
create or replace function public.koda_cron_call(p_function text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_id     bigint;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'cron_secret'
   limit 1;
  if v_secret is null then
    raise exception 'koda_cron_call: falta el secreto "cron_secret" en Vault';
  end if;

  select net.http_post(
    url     := 'https://keudcycnwjuneaclezjk.supabase.co/functions/v1/' || p_function,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) into v_id;
  return v_id;
end;
$$;

-- Solo el cron (postgres) puede dispararla: nunca desde la API pública.
revoke all on function public.koda_cron_call(text) from public, anon, authenticated;

-- Normalizer cada 10 minutos.
select cron.schedule('koda-normalizer', '*/10 * * * *', $$ select public.koda_cron_call('koda-normalizer'); $$);

-- Scorer cada 10 minutos (desfasado 2 min para correr tras el normalizer).
select cron.schedule('koda-scorer', '2-59/10 * * * *', $$ select public.koda_cron_call('koda-scorer'); $$);

-- Notifier cada minuto — drena la cola de notifications a Discord.
select cron.schedule('koda-notifier', '* * * * *', $$ select public.koda_cron_call('koda-notifier'); $$);

-- Digest diario 07:00 America/Guayaquil = 12:00 UTC (un resumen POR USUARIO).
select cron.schedule('koda-digest', '0 12 * * *', $$ select public.koda_cron_call('koda-digest'); $$);
