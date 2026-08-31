# KODA — Edge Functions (Fase 2: ingesta)

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
| `koda-scorer` | Calcula `score`, `score_desglose` y `plan_sugerido` desde las señales y `scoring_rules`. Encola aviso si cruza a caliente. | `{}` o `{ all: true }` |

`_shared/` tiene utilidades reutilizables (normalización, dedupe, scoring, fuentes).

## Secrets (Supabase → Edge Functions → Secrets)

Copiá `supabase/.env.functions.example` a `supabase/.env.functions`, completá y:

```bash
supabase secrets set --env-file supabase/.env.functions
```

Mínimo para OSM (gratis): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
Para Google Places (pago): agregá `GOOGLE_PLACES_API_KEY` y `COSTO_MAX_MENSUAL_USD`.

> `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` suelen inyectarse solos en las
> Edge Functions; setealos igual si tu proyecto no los expone.

## Desplegar

```bash
supabase link --project-ref <PROJECT_REF>
supabase functions deploy koda-collector
supabase functions deploy koda-normalizer
supabase functions deploy koda-scorer
```

## Programar (pg_cron)

Ejecutá `supabase/migrations/0004_cron.sql` en el SQL Editor reemplazando
`<PROJECT_REF>` y `<SERVICE_ROLE_KEY>`. Agenda el normalizer y el scorer cada
10 min. Los jobs con `cron` propio se agendan aparte al crearlos.

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
