# KODA — Edge Functions (Fase 2: ingesta · Fase 3: notificaciones)

Pipeline de ingesta que corre en Supabase (Deno). El navegador **nunca** ve la
`service_role key` ni las API keys de las fuentes.

```
search_job → koda-collector → raw_records → koda-normalizer → prospects (+señales)
                                                   → koda-scorer → score + desglose + plan
```

## Funciones

| Función | Qué hace | Entrada |
|---|---|---|
| `koda-collector` | Ejecuta un job contra su fuente (OSM Overpass gratis, o Google Places con key) y guarda el crudo en `raw_records`. Controla costo mensual. | `{ job_id }` |
| `koda-normalizer` | Toma `raw_records` sin procesar (lotes de 50), normaliza (teléfono E.164, URL limpia), deduplica (5.7), respeta la lista negra de supresión, inserta señales. | `{}` |
| `koda-scorer` | Calcula `score`, `score_desglose` y `plan_sugerido` desde las señales y `scoring_rules`. Encola aviso si cruza a caliente (umbral configurable en `app_config.hot_threshold`). | `{}` o `{ all: true }` |
| `koda-notifier` | **(Fase 3)** Envía a Discord la cola de `notifications` pendientes según el canal. | `{}` (enviar cola) · `{ check: true }` (estado webhooks) · `{ test: true, canal }` (prueba) |
| `koda-digest` | **(Fase 3)** Arma un resumen (nuevos, calientes, por ciudad) y lo encola como notificación `reportes`. **Por usuario**: el cron genera uno para cada usuario con webhook de reportes. | `{}` o `{ periodo_horas }` |
| `koda-users` | **(Multiusuario)** Alta de cuentas y restablecer contraseña. Solo Super Admin (usa la Auth Admin API, que necesita la `service_role`). | `{ action: 'create', email, password, nombre, rol, permisos, tope_costo_mensual }` · `{ action: 'reset_password', user_id, password }` |

`_shared/` tiene utilidades reutilizables (normalización, dedupe, scoring, fuentes,
dueños/webhooks por usuario).

## Multiusuario

Cada usuario tiene su propia base de prospectos, sus búsquedas y sus claves. Como
estas funciones usan la `service_role` (se saltan RLS), **el aislamiento se aplica
en el código**:

- `requireCaller` identifica quién llama y exige que esté **activo**. `can()` /
  `caller.isAdmin` deciden qué puede tocar.
- El collector solo ejecuta un job al **dueño** (`search_jobs.owner_id`), al Super
  Admin o al cron, y exige las funciones `busquedas` (y `google_places` para Google).
- El normalizer deduplica **dentro del dueño** de cada `raw_record`; un mismo
  negocio puede existir en la base de dos usuarios.
- Las claves por usuario (`google_places_api_key`, `discord_webhook_*`) viven
  cifradas en Supabase Vault y solo se leen aquí con la RPC `get_user_secrets`
  (ejecutable únicamente por `service_role`). El navegador solo ve los últimos 4
  caracteres.
- Los secretos globales (`GOOGLE_PLACES_API_KEY`, `DISCORD_WEBHOOK_*`) quedan como
  respaldo **solo del Super Admin** y de los avisos de sistema sin dueño.
- Los webhooks escritos por usuarios deben ser de `discord.com` (anti-SSRF).

Los rubros de OSM (qué se traduce cada categoría a tags de OpenStreetMap) viven en
`_shared/sources/osm.ts` (`RUBRO_TAGS`). El campo `search_jobs.categorias` guarda
las claves elegidas en el panel.

## Secrets (Supabase → Edge Functions → Secrets)

Copiá `supabase/.env.functions.example` a `supabase/.env.functions`, completá y:

```bash
supabase secrets set --env-file supabase/.env.functions
```

Mínimo para OSM (gratis): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
Para Google Places (pago): agregá `GOOGLE_PLACES_API_KEY` y `COSTO_MAX_MENSUAL_USD`.
Para el cron: `CRON_SECRET` (ver "Programar (pg_cron)" más abajo).
Para Discord (Fase 3): un webhook por canal —
`DISCORD_WEBHOOK_HOT`, `DISCORD_WEBHOOK_NUEVOS`, `DISCORD_WEBHOOK_REPORTES`,
`DISCORD_WEBHOOK_ERRORES` (o `DISCORD_WEBHOOK_DEFAULT` como respaldo para todos).

> `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` suelen inyectarse solos en las
> Edge Functions; setealos igual si tu proyecto no los expone.

## Desplegar

```bash
supabase link --project-ref <PROJECT_REF>
supabase functions deploy koda-collector
supabase functions deploy koda-normalizer
supabase functions deploy koda-scorer
supabase functions deploy koda-notifier   # Fase 3
supabase functions deploy koda-digest     # Fase 3
supabase functions deploy koda-users      # Multiusuario
```

> **Orden al activar multiusuario:** primero la migración `0006_multiusuario.sql`
> (crea `owner_id`, permisos y los secretos), **después** desplegar las funciones y
> el front. Las funciones nuevas dependen de las columnas y RPC de esa migración.

## Migraciones nuevas

- `0006_multiusuario.sql`: convierte KODA a multiusuario. Agrega `profiles.permisos`
  y `owner_id` en prospectos / búsquedas / ejecuciones / etiquetas (todo lo existente
  pasa al Super Admin), reescribe RLS por dueño, la unicidad pasa a ser por dueño,
  crea los secretos por usuario en Vault (`set_my_secret`, `get_user_secrets`…) y
  `admin_user_stats()`. Los registros nuevos en Auth nacen **inactivos**: solo el
  Super Admin los habilita al crearlos desde el panel. Idempotente.

- `0005_audit_retention.sql`: crea `app_config` (umbral caliente, días de
  retención), los triggers de auditoría (`audit_log` se llena solo) y la función
  de retención `anonimizar_prospectos_antiguos()` (anonimiza, no borra, tras 365
  días sin actividad; ya queda programada con pg_cron — es SQL puro, sin secretos).

## Programar (pg_cron)

Los 4 cron (normalizer y scorer cada 10 min, notifier cada minuto, digest 12:00 UTC =
07:00 Guayaquil) los agenda `supabase/migrations/0007_cron_secret.sql`. **No uses
`0004_cron.sql`**: está obsoleta (embebía una clave en `cron.job`; el gateway la
rechazaba con 401 `UNAUTHORIZED_INVALID_JWT_FORMAT`).

Cómo funciona ahora:

```
pg_cron → public.koda_cron_call('koda-…') → POST con cabecera x-cron-secret → Edge Function
            (lee `cron_secret` de Vault)                                        └ requireCaller lo compara con CRON_SECRET
```

- Esas 4 funciones se despliegan con `verify_jwt = false` (está en
  `supabase/config.toml`, así un `functions deploy` normal no lo revierte): el cron
  no manda un JWT. **La autenticación la hace siempre `requireCaller`** — secreto de
  cron válido, o JWT de un usuario activo. No llames a `req.json()` ni hagas nada
  antes de `requireCaller` en esas funciones.
- `koda-collector` y `koda-users` siguen con `verify_jwt = true` (solo las llama el panel).
- El secreto nunca está en el repo ni en `cron.job`. Se crea una sola vez, a mano:

  ```bash
  openssl rand -hex 32                                   # genera el valor
  supabase secrets set CRON_SECRET=<valor>               # Edge Functions
  # y en la base (misma cadena), con `supabase db query --linked`:
  #   select vault.create_secret('<valor>', 'cron_secret', 'Secreto compartido pg_cron -> Edge Functions KODA');
  ```

  Para rotarlo: `vault.update_secret(<id>, '<nuevo>')` y `secrets set` con el mismo valor.
- Aplicar migraciones con `npx supabase db query --linked -f <archivo>` (nunca `db push`).
- Ver respuestas: `select status_code, content, created from net._http_response order by created desc limit 20;`
  y ejecuciones: `select * from cron.job_run_details order by start_time desc limit 20;`.

La retención se agenda sola desde `0005`.

## Probar

- Desde el panel: **Búsquedas → Ejecutar ahora** (corre collector → normalizer → scorer).
- Por CLI:
  ```bash
  curl -X POST 'https://<PROJECT_REF>.supabase.co/functions/v1/koda-collector' \
    -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
    -H 'Content-Type: application/json' \
    -d '{"job_id":"<UUID_DEL_JOB>"}'
  ```

## Notas de cumplimiento

- **OSM/Overpass** (ODbL): se puede almacenar citando la fuente. Es la fuente por defecto.
- **Google Places**: se guarda `place_id` de forma permanente; los campos se
  refrescan (no se almacenan indefinidamente sin actualizar). Ver sección 4.3.
- Nada de scraping de redes sociales (sección 4.2).
