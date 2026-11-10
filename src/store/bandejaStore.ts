import { create } from 'zustand';
import type { Conversacion, EnvioMini, Mensaje } from '@/lib/data/bandeja';
import {
  aplicarEnvios, enviosFaltantes, fusionarConversacion, fusionarConversaciones, fusionarMensaje, fusionarMensajes, totalNoLeidos,
} from '@/lib/bandeja/orden';

export type EstadoConexion = 'conectando' | 'en_vivo' | 'reconectando' | 'sin_conexion';

export interface Hilo {
  mensajes: Mensaje[];
  /** ¿Hay mensajes más viejos por cargar? */
  hayMas: boolean;
  cargando: boolean;
  cargandoMas: boolean;
  /** Ya se trajeron los más recientes (antes solo pueden haber llegado avisos sueltos en vivo). */
  cargado: boolean;
  error: string | null;
}

export const hiloVacio = (): Hilo => ({ mensajes: [], hayMas: false, cargando: false, cargandoMas: false, cargado: false, error: null });

const guardado = (k: string, defecto: boolean): boolean => {
  try { const v = localStorage.getItem(k); return v === null ? defecto : v === '1'; } catch { return defecto; }
};

interface BandejaState {
  conversaciones: Conversacion[];
  cargandoLista: boolean;
  listaCargada: boolean;
  errorLista: string | null;
  hilos: Record<string, Hilo>;
  conexion: EstadoConexion;
  /** Suma de no leídos (sin archivadas): lo que muestra el menú y el título de la pestaña. */
  noLeidos: number;
  convAbierta: string | null;
  sonido: boolean;

  setConexion: (c: EstadoConexion) => void;
  setConvAbierta: (id: string | null) => void;
  setSonido: (v: boolean) => void;
  setLista: (p: Partial<Pick<BandejaState, 'cargandoLista' | 'listaCargada' | 'errorLista'>>) => void;
  fusionarConv: (c: Conversacion) => void;
  fusionarConvs: (cs: Conversacion[]) => void;
  actualizarConv: (id: string, cambios: Partial<Conversacion>) => void;
  ponerEnvios: (envios: EnvioMini[], ids: string[]) => void;
  fusionarMsg: (m: Mensaje) => void;
  fusionarMsgs: (convId: string, ms: Mensaje[]) => void;
  actualizarMsg: (convId: string, id: string, cambios: Partial<Mensaje>) => void;
  quitarMsg: (convId: string, id: string) => void;
  ponerHilo: (convId: string, cambios: Partial<Hilo>) => void;
  soltarHilos: (conservar: (id: string, h: Hilo) => boolean) => void;
  reset: () => void;
}

const inicial = () => ({
  conversaciones: [] as Conversacion[],
  cargandoLista: false,
  listaCargada: false,
  errorLista: null as string | null,
  hilos: {} as Record<string, Hilo>,
  conexion: 'conectando' as EstadoConexion,
  noLeidos: 0,
  convAbierta: null as string | null,
});

export const useBandejaStore = create<BandejaState>((set) => ({
  ...inicial(),
  sonido: guardado('koda.bandeja.sonido', true),

  setConexion: (conexion) => set({ conexion }),
  setConvAbierta: (convAbierta) => set({ convAbierta }),
  setSonido: (sonido) => {
    try { localStorage.setItem('koda.bandeja.sonido', sonido ? '1' : '0'); } catch { /* sin almacenamiento */ }
    set({ sonido });
  },
  setLista: (p) => set(p),

  fusionarConv: (c) => set((s) => {
    const conversaciones = fusionarConversacion(s.conversaciones, c);
    return conversaciones === s.conversaciones ? s : { conversaciones, noLeidos: totalNoLeidos(conversaciones) };
  }),
  fusionarConvs: (cs) => set((s) => {
    const conversaciones = fusionarConversaciones(s.conversaciones, cs);
    return conversaciones === s.conversaciones ? s : { conversaciones, noLeidos: totalNoLeidos(conversaciones) };
  }),
  actualizarConv: (id, cambios) => set((s) => {
    const conversaciones = s.conversaciones.map((c) => (c.id === id ? { ...c, ...cambios } : c));
    return { conversaciones, noLeidos: totalNoLeidos(conversaciones) };
  }),
  ponerEnvios: (envios, ids) => set((s) => {
    let conversaciones = aplicarEnvios(s.conversaciones, envios);
    // Los que se pidieron y no existen (o no se pueden ver) quedan en null: así no se vuelven a pedir en bucle.
    conversaciones = conversaciones.map((c) => (c.envio_id && ids.includes(c.envio_id) && c.envio === undefined ? { ...c, envio: null } : c));
    return { conversaciones };
  }),

  fusionarMsg: (m) => set((s) => {
    const h = s.hilos[m.conversacion_id] ?? hiloVacio();
    const mensajes = fusionarMensaje(h.mensajes, m);
    if (mensajes === h.mensajes && s.hilos[m.conversacion_id]) return s;
    return { hilos: { ...s.hilos, [m.conversacion_id]: { ...h, mensajes } } };
  }),
  fusionarMsgs: (convId, ms) => set((s) => {
    const h = s.hilos[convId] ?? hiloVacio();
    return { hilos: { ...s.hilos, [convId]: { ...h, mensajes: fusionarMensajes(h.mensajes, ms) } } };
  }),
  actualizarMsg: (convId, id, cambios) => set((s) => {
    const h = s.hilos[convId];
    if (!h) return s;
    return { hilos: { ...s.hilos, [convId]: { ...h, mensajes: h.mensajes.map((m) => (m.id === id ? { ...m, ...cambios } : m)) } } };
  }),
  quitarMsg: (convId, id) => set((s) => {
    const h = s.hilos[convId];
    if (!h) return s;
    return { hilos: { ...s.hilos, [convId]: { ...h, mensajes: h.mensajes.filter((m) => m.id !== id) } } };
  }),
  ponerHilo: (convId, cambios) => set((s) => ({ hilos: { ...s.hilos, [convId]: { ...(s.hilos[convId] ?? hiloVacio()), ...cambios } } })),
  soltarHilos: (conservar) => set((s) => ({
    hilos: Object.fromEntries(Object.entries(s.hilos).filter(([id, h]) => conservar(id, h))),
  })),

  reset: () => set({ ...inicial() }),
}));

export { enviosFaltantes };
