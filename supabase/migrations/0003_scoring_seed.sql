-- ============================================================================
-- KODA · 0003_scoring_seed.sql
-- Semilla de reglas de scoring (sección 6.1) y fuentes base (sección 4).
-- Idempotente: usa upsert por clave/nombre.
-- ============================================================================

-- ── Reglas de scoring ───────────────────────────────────────────────────────
insert into scoring_rules (clave, descripcion, puntos, orden) values
  ('sin_web',             'No tiene sitio web propio',              20, 1),
  ('usa_linktree',        'Usa Linktree/Beacons/similar',           15, 2),
  ('ig_o_fb_activo',      'Red social con actividad reciente',      12, 3),
  ('whatsapp_publico',    'Publica número de WhatsApp',             10, 4),
  ('resenas_10_plus',     '10 o más reseñas en Google',             10, 5),
  ('rating_4_plus',       'Calificación ≥ 4.0',                      8, 6),
  ('ciudad_objetivo',     'Ciudad con vendedor asignado',           10, 7),
  ('rubro_con_plantilla', 'Rubro con plantilla de Connexo',          8, 8),
  ('contacto_directo',    'Teléfono o email verificable',            7, 9),
  ('web_rota_o_lenta',    'Web con error o no responsive',          12, 10),
  ('multi_sucursal',      'Aparece en varias ubicaciones',           6, 11),
  ('cerrado_permanente',  'Google lo marca como cerrado',          -60, 12),
  ('sin_ningun_contacto', 'No hay forma de contactarlo',           -25, 13),
  ('ya_es_cliente',       'Coincide con Connexo Clients',         -100, 14),
  ('opt_out',             'Pidió no ser contactado',              -100, 15)
on conflict (clave) do update
  set descripcion = excluded.descripcion,
      puntos      = excluded.puntos,
      orden       = excluded.orden;

-- ── Fuentes base ────────────────────────────────────────────────────────────
-- Nombres usados por la app al insertar (importación/curaduría) y por la ingesta.
-- Se exige unicidad por nombre para que el seed y los lookups por nombre sean fiables.
create unique index if not exists sources_nombre_key on sources (nombre);

insert into sources (nombre, tipo, activo) values
  ('Google Places',    'api',    true),
  ('OSM Overpass',     'api',    true),
  ('CSV / Aliado',     'csv',    true),
  ('Importación CSV',  'csv',    true),
  ('Curaduría manual', 'manual', true)
on conflict (nombre) do nothing;
