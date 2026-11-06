// Catálogo de funciones (permisos) que el super_admin puede habilitar por usuario.
// ⚠️ Debe coincidir con src/lib/permissions.ts (front) y con las políticas RLS de
// supabase/migrations/0006_multiusuario.sql.
export const PERMISOS_VALIDOS = [
  'busquedas',
  'google_places',
  'importar',
  'curaduria',
  'duplicados',
  'mapa',
  'reportes',
  'exportar',
  'eliminar',
  'discord',
] as const;

export type Permiso = (typeof PERMISOS_VALIDOS)[number];

export const ROLES_VALIDOS = ['super_admin', 'analista', 'lector'] as const;

/** Filtra una lista cualquiera dejando solo permisos conocidos, sin duplicados. */
export function sanearPermisos(input: unknown): Permiso[] {
  if (!Array.isArray(input)) return [];
  const validos = new Set<string>(PERMISOS_VALIDOS);
  return [...new Set(input.filter((p): p is string => typeof p === 'string' && validos.has(p)))] as Permiso[];
}
