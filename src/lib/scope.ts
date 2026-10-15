/**
 * Helpers de la capa de datos para el alcance (dueño) elegido por el Super Admin.
 * Para un usuario normal no hacen nada: RLS ya limita todo a sus propias filas.
 */
import { useScopeStore } from '@/store/scopeStore';

/** Restringe una consulta de lectura al dueño elegido en el selector. */
export function byOwner<T>(query: T): T {
  const id = useScopeStore.getState().ownerId;
  // El builder de Supabase no se infiere bien con `db` sin tipar: cast local.
  return id ? ((query as unknown as { eq: (c: string, v: string) => T }).eq('owner_id', id)) : query;
}

/** `owner_id` explícito para altas (solo cuando el Super Admin actúa sobre otro usuario). */
export function ownerForInsert(): { owner_id?: string } {
  const id = useScopeStore.getState().ownerId;
  return id ? { owner_id: id } : {};
}
