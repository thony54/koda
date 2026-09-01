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
| `koda-digest` | **(Fase 3)** Arma un resumen (nuevos, calientes, por ciudad) y lo encola como notificación `reportes`. | `{}` o `{ periodo_horas }` |

`_shared/` tiene utilidades reutilizables (normalización, dedupe, scoring, fuentes).

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
```

## Migraciones nuevas

- `0005_audit_retention.sql`: crea `app_config` (umbral caliente, días de
  retención), los triggers de auditoría (`audit_log` se llena solo) y la función
  de retención `anonimizar_prospectos_antiguos()` (anonimiza, no borra, tras 365
  días sin actividad; ya queda programada con pg_cron — es SQL puro, sin secretos).

## Programar (pg_cron)

Ejecutá `supabase/migrations/0004_cron.sql` en el SQL Editor reemplazando
`<PROJECT_REF>` y `<SERVICE_ROLE_KEY>`. Agenda el normalizer y el scorer cada
10 min. **Fase 3:** descomentá los bloques `koda-notifier` (cada minuto) y
`koda-digest` (diario 12:00 UTC = 07:00 Guayaquil). Los jobs con `cron` propio se
agendan aparte al crearlos. La retención se agenda sola desde `0005`.

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
