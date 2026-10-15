import { create } from 'zustand';

/**
 * ¿De quién son los datos que se están viendo?
 *
 * - Usuario normal: siempre `ownerId = null`. RLS ya le muestra solo lo suyo.
 * - Cuenta propietaria: arranca en "Mis datos" (su propio id) y puede cambiar a otro
 *   usuario o a "Todos" (`null`) desde el selector de la barra superior.
 */
interface ScopeState {
  ownerId: string | null;
  label: string;
  /** Ya se resolvió el alcance inicial para esta sesión. */
  ready: boolean;
  setScope: (ownerId: string | null, label: string) => void;
  /** Alcance inicial al cargar el perfil (no pisa una elección ya hecha). */
  initFor: (profile: { id: string; es_propietario?: boolean }) => void;
  reset: () => void;
}

export const useScopeStore = create<ScopeState>((set, get) => ({
  ownerId: null,
  label: 'Mis datos',
  ready: false,
  setScope: (ownerId, label) => set({ ownerId, label, ready: true }),
  initFor: (profile) => {
    if (get().ready) return;
    set({
      ownerId: profile.es_propietario ? profile.id : null,
      label: 'Mis datos',
      ready: true,
    });
  },
  reset: () => set({ ownerId: null, label: 'Mis datos', ready: false }),
}));
