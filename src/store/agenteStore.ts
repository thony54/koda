import { create } from 'zustand';
import type { BorradorAgente, ConfigAgente, ResumenAgente } from '@/lib/data/agente';

interface AgenteState {
  config: ConfigAgente | null;
  /** ¿Está guardada la clave de Anthropic en Supabase? null = aún no se sabe. */
  clave: boolean | null;
  resumen: ResumenAgente | null;
  /** El borrador PENDIENTE de cada chat (a lo sumo uno por chat). */
  borradores: Record<string, BorradorAgente>;
  /** Chats donde se está pidiendo «otra versión». */
  generando: Record<string, boolean>;
  cargado: boolean;

  setConfig: (c: ConfigAgente | null) => void;
  setClave: (v: boolean | null) => void;
  setResumen: (r: ResumenAgente | null) => void;
  setBorradores: (lista: BorradorAgente[]) => void;
  fusionarBorrador: (b: BorradorAgente) => void;
  quitarBorrador: (convId: string, id?: string) => void;
  setGenerando: (convId: string, v: boolean) => void;
  setCargado: (v: boolean) => void;
  reset: () => void;
}

export const useAgenteStore = create<AgenteState>((set) => ({
  config: null,
  clave: null,
  resumen: null,
  borradores: {},
  generando: {},
  cargado: false,

  setConfig: (config) => set({ config }),
  setClave: (clave) => set({ clave }),
  setResumen: (resumen) => set({ resumen }),
  setBorradores: (lista) => set({
    borradores: Object.fromEntries(
      [...lista].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((b) => [b.conversacion_id, b]),
    ),
  }),
  // Realtime y recargas llegan en cualquier orden: solo vale el pendiente más nuevo de cada chat; si el borrador del chat se
  // resolvió (enviado, descartado, reemplazado…), se quita.
  fusionarBorrador: (b) => set((s) => {
    const actual = s.borradores[b.conversacion_id];
    if (b.estado === 'pendiente') {
      if (actual && actual.id !== b.id && actual.created_at > b.created_at) return s;
      return { borradores: { ...s.borradores, [b.conversacion_id]: b } };
    }
    if (actual && actual.id === b.id) {
      const { [b.conversacion_id]: _quitado, ...resto } = s.borradores;
      return { borradores: resto };
    }
    return s;
  }),
  quitarBorrador: (convId, id) => set((s) => {
    const actual = s.borradores[convId];
    if (!actual || (id && actual.id !== id)) return s;
    const { [convId]: _quitado, ...resto } = s.borradores;
    return { borradores: resto };
  }),
  setGenerando: (convId, v) => set((s) => ({ generando: { ...s.generando, [convId]: v } })),
  setCargado: (cargado) => set({ cargado }),
  reset: () => set({ config: null, clave: null, resumen: null, borradores: {}, generando: {}, cargado: false }),
}));
