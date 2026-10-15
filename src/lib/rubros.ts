/**
 * Rubros (grupos de negocio). La clave se guarda en search_jobs.categorias, en el espacio
 * del usuario (koda_perfil.rubros) y el collector de OSM la traduce a filtros reales
 * (RUBRO_TAGS en supabase/functions/_shared/sources/osm.ts). Mantener en sync con
 * supabase/functions/_shared/rubros.ts, que hace el camino inverso (categoría → grupo).
 */
export const RUBROS: { value: string; label: string }[] = [
  { value: 'restaurantes', label: 'Restaurantes' },
  { value: 'cafe_bar', label: 'Cafés y bares' },
  { value: 'belleza', label: 'Belleza y peluquerías' },
  { value: 'salud', label: 'Salud y clínicas' },
  { value: 'gimnasios', label: 'Gimnasios' },
  { value: 'hoteles', label: 'Hoteles y hospedaje' },
  { value: 'tiendas', label: 'Tiendas' },
  { value: 'talleres', label: 'Talleres y servicios' },
  { value: 'oficinas', label: 'Oficinas y profesionales' },
];

export const RUBRO_LABEL: Record<string, string> = Object.fromEntries(RUBROS.map((r) => [r.value, r.label]));
