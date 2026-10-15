/**
 * Catálogo de funciones que el Super Admin puede habilitar por usuario, y helpers
 * para consultarlas. La seguridad real vive en RLS y en las Edge Functions
 * (0006_multiusuario.sql); esto solo decide qué se MUESTRA en la interfaz.
 */
import type { PermissionKey, Profile, UserRole } from '@/types/database';

export type { PermissionKey };

export interface PermissionDef {
  key: PermissionKey;
  label: string;
  description: string;
  group: 'Prospección' | 'Análisis' | 'Datos' | 'Integraciones';
}

export const PERMISSIONS: PermissionDef[] = [
  { key: 'busquedas', label: 'Búsquedas', group: 'Prospección',
    description: 'Crear y ejecutar búsquedas de prospectos (OpenStreetMap, gratis).' },
  { key: 'google_places', label: 'Google Places', group: 'Prospección',
    description: 'Usar Google Places como fuente, con su propia API key.' },
  { key: 'importar', label: 'Importar CSV', group: 'Prospección',
    description: 'Cargar prospectos desde archivos CSV.' },
  { key: 'curaduria', label: 'Curaduría', group: 'Prospección',
    description: 'Agregar creadores de contenido y perfiles a mano.' },
  { key: 'duplicados', label: 'Duplicados', group: 'Datos',
    description: 'Revisar y fusionar prospectos duplicados.' },
  { key: 'eliminar', label: 'Eliminar prospectos', group: 'Datos',
    description: 'Borrar prospectos de su base.' },
  { key: 'exportar', label: 'Exportar CSV', group: 'Datos',
    description: 'Descargar sus prospectos en archivos CSV.' },
  { key: 'mapa', label: 'Mapa', group: 'Análisis',
    description: 'Ver sus prospectos en el mapa.' },
  { key: 'reportes', label: 'Reportes', group: 'Análisis',
    description: 'Ver reportes y estadísticas de sus prospectos.' },
  { key: 'discord', label: 'Discord', group: 'Integraciones',
    description: 'Recibir avisos en sus propios canales de Discord.' },
];

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);

export const PERMISSION_LABEL = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.label])) as Record<PermissionKey, string>;

/** Combinaciones frecuentes para no marcar casilla por casilla. */
export const PERMISSION_PRESETS: { id: string; label: string; hint: string; permisos: PermissionKey[] }[] = [
  {
    id: 'completo',
    label: 'Completo',
    hint: 'Todas las funciones, incluida Google Places',
    permisos: ALL_PERMISSION_KEYS,
  },
  {
    id: 'prospeccion',
    label: 'Prospección',
    hint: 'Busca, importa, limpia y exporta (sin Google ni borrar)',
    permisos: ['busquedas', 'importar', 'duplicados', 'exportar', 'mapa', 'reportes'],
  },
  {
    id: 'consulta',
    label: 'Solo consulta',
    hint: 'Ve sus prospectos, mapa y reportes',
    permisos: ['mapa', 'reportes'],
  },
];

/** ¿Este perfil puede usar la función? (super_admin: siempre; sin clave: solo activo). */
export function hasPermission(profile: Profile | null | undefined, key?: PermissionKey): boolean {
  if (!profile || !profile.activo) return false;
  if (!key) return true;
  return profile.rol === 'super_admin' || (profile.permisos ?? []).includes(key);
}

/** Regla de acceso de una pantalla/ítem de menú: rol permitido Y función habilitada. */
export interface AccessRule {
  roles?: UserRole[];
  permiso?: PermissionKey;
}

export function canAccess(profile: Profile | null | undefined, rule: AccessRule): boolean {
  if (!profile?.activo) return false;
  if (rule.roles?.length && !rule.roles.includes(profile.rol)) return false;
  return hasPermission(profile, rule.permiso);
}

/** ¿Puede modificar datos (analista/super_admin) o solo mirar (lector)? */
export function canWrite(profile: Profile | null | undefined): boolean {
  return Boolean(profile?.activo && (profile.rol === 'super_admin' || profile.rol === 'analista'));
}
