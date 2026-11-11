/**
 * Operaciones del agente sobre su store: cargar, cambiar el modo, descartar, pedir otra versión y pausar un chat.
 * Igual que la bandeja, todo se mezcla de forma idempotente: da igual si un dato llega por Realtime o por una recarga.
 */
import {
  descartarBorradorAgente, estadoClaveAgente, generarBorradorAgente, getConfigAgente, listBorradoresPendientes, pausarAgenteEnChat,
  resumenAgente, setModoAgente, type BorradorAgente, type ModoAgente, type ResultadoGenerar,
} from '@/lib/data/agente';
import { useAgenteStore } from '@/store/agenteStore';
import { useBandejaStore } from '@/store/bandejaStore';

const st = () => useAgenteStore.getState();
const mensajeDe = (e: unknown, defecto: string) => (e instanceof Error && e.message ? e.message : defecto);

/** Config, borradores pendientes y resumen. Cada parte falla por su cuenta: si la migración 0017 aún no está, la Bandeja sigue igual. */
export async function cargarAgente(): Promise<void> {
  const [cfg, pend, res] = await Promise.allSettled([getConfigAgente(), listBorradoresPendientes(), resumenAgente()]);
  if (cfg.status === 'fulfilled') st().setConfig(cfg.value);
  if (pend.status === 'fulfilled') st().setBorradores(pend.value);
  if (res.status === 'fulfilled') st().setResumen(res.value);
  st().setCargado(cfg.status === 'fulfilled');
}

export async function refrescarResumen(): Promise<void> {
  try { st().setResumen(await resumenAgente()); } catch { /* se verá en la próxima carga */ }
}

export async function comprobarClave(): Promise<void> {
  try { st().setClave((await estadoClaveAgente()).clave); } catch { st().setClave(null); }
}

export async function cambiarModo(modo: ModoAgente): Promise<{ ok: boolean; error?: string }> {
  const antes = st().config;
  if (antes) st().setConfig({ ...antes, modo });                      // al instante; Realtime lo confirma
  try { await setModoAgente(modo); return { ok: true }; }
  catch (e) { if (antes) st().setConfig(antes); return { ok: false, error: mensajeDe(e, 'No se pudo cambiar el modo.') }; }
}

export async function descartarBorrador(b: BorradorAgente): Promise<void> {
  st().quitarBorrador(b.conversacion_id, b.id);
  try { await descartarBorradorAgente(b.id); void refrescarResumen(); } catch { void cargarAgente(); }
}

/** «Otra versión»: vuelve a redactar. El borrador nuevo llega solo por Realtime (o con la recarga si no hay conexión en vivo). */
export async function otraVersion(convId: string): Promise<ResultadoGenerar> {
  st().setGenerando(convId, true);
  try {
    const r = await generarBorradorAgente(convId);
    if (r.ok === false || r.error) return { ok: false, error: r.error ?? 'No se pudo redactar.', sin_clave: r.sin_clave };
    void cargarAgente();
    return r;
  } catch (e) {
    return { ok: false, error: mensajeDe(e, 'No se pudo redactar.') };
  } finally {
    st().setGenerando(convId, false);
  }
}

export async function pausarEnChat(convId: string, valor: boolean): Promise<void> {
  useBandejaStore.getState().actualizarConv(convId, { agente_pausado: valor });
  try { await pausarAgenteEnChat(convId, valor); }
  catch { useBandejaStore.getState().actualizarConv(convId, { agente_pausado: !valor }); }
}
