/**
 * Conexión en vivo de la bandeja: una suscripción de Supabase Realtime a las dos tablas, con reconexión y recarga.
 *
 *   · Cada cambio entra al store con las mismas funciones de mezcla que una recarga (idempotentes y con versión).
 *   · Al (re)conectar se recarga todo: lo que pasó mientras no había conexión nunca se pierde.
 *   · Si la conexión no vuelve en 15 s se recrea el canal; al volver a la pestaña o a tener internet se recarga.
 */
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Conversacion, Mensaje } from '@/lib/data/bandeja';
import { completarEnvios, refrescarTodo } from '@/lib/bandeja/acciones';
import { tituloConversacion } from '@/lib/bandeja/orden';
import { useBandejaStore } from '@/store/bandejaStore';

const st = () => useBandejaStore.getState();
const ESPERA_REABRIR_MS = 15_000;

// ── Aviso de mensaje nuevo ──────────────────────────────────────────────────

let audio: AudioContext | null = null;
/** Un «ding» corto con Web Audio (sin archivos). Si el navegador aún no deja sonar, se ignora en silencio. */
function sonar() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === 'suspended') void audio.resume();
    const t0 = audio.currentTime;
    for (const [i, f] of [880, 1318].entries()) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.11);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + i * 0.11 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.11 + 0.22);
      o.connect(g).connect(audio.destination);
      o.start(t0 + i * 0.11);
      o.stop(t0 + i * 0.11 + 0.25);
    }
  } catch { /* sin audio */ }
}

const viendoElChat = (convId: string) =>
  document.visibilityState === 'visible' && document.hasFocus() && st().convAbierta === convId;

function avisarNuevo(m: Mensaje) {
  if (m.direccion !== 'entrante' || m.tipo === 'reaction') return;
  if (viendoElChat(m.conversacion_id)) return;
  if (st().sonido) sonar();
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && (document.visibilityState !== 'visible' || !document.hasFocus())) {
    const c = st().conversaciones.find((x) => x.id === m.conversacion_id);
    const titulo = c ? tituloConversacion(c) : 'WhatsApp de Connexo';
    try {
      const n = new Notification(titulo, { body: (m.texto ?? '').slice(0, 140) || 'Nuevo mensaje', tag: `wa-${m.conversacion_id}`, icon: '/logo.png' });
      n.onclick = () => { window.focus(); window.location.assign(`/bandeja?c=${m.conversacion_id}`); n.close(); };
    } catch { /* algunos navegadores solo permiten Notification desde un service worker */ }
  }
}

// ── Suscripción ─────────────────────────────────────────────────────────────

function alCambiarConversacion(p: RealtimePostgresChangesPayload<Record<string, unknown>>) {
  if (p.eventType === 'DELETE') return;
  st().fusionarConv(p.new as unknown as Conversacion);
  void completarEnvios();
}

function alCambiarMensaje(p: RealtimePostgresChangesPayload<Record<string, unknown>>) {
  if (p.eventType === 'DELETE') return;
  const m = p.new as unknown as Mensaje;
  st().fusionarMsg(m);
  if (p.eventType === 'INSERT') avisarNuevo(m);
}

/** Arranca la bandeja en vivo. Devuelve la función que la detiene (al cerrar sesión o salir de la app). */
export function iniciarBandejaEnVivo(): () => void {
  let canal: RealtimeChannel | null = null;
  let detenido = false;
  let vigilante: number | undefined;
  let contador = 0;

  const abrir = () => {
    if (detenido) return;
    st().setConexion(st().listaCargada ? 'reconectando' : 'conectando');
    const c = supabase
      .channel(`wa-bandeja-${Date.now()}-${++contador}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_conversaciones' }, alCambiarConversacion)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_mensajes' }, alCambiarMensaje)
      .subscribe((estado) => {
        if (detenido || canal !== c) return;
        if (estado === 'SUBSCRIBED') {
          window.clearTimeout(vigilante);
          st().setConexion('en_vivo');
          // Todo lo que pasó antes de estar suscritos (o durante una caída) se recupera aquí.
          void refrescarTodo();
        } else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' || estado === 'CLOSED') {
          st().setConexion(estado === 'CLOSED' ? 'sin_conexion' : 'reconectando');
          window.clearTimeout(vigilante);
          vigilante = window.setTimeout(reabrir, ESPERA_REABRIR_MS);
        }
      });
    canal = c;
    // Si ni siquiera llega a suscribirse, se recrea.
    window.clearTimeout(vigilante);
    vigilante = window.setTimeout(reabrir, ESPERA_REABRIR_MS * 2);
  };

  const reabrir = () => {
    if (detenido) return;
    const viejo = canal;
    canal = null;
    if (viejo) void supabase.removeChannel(viejo);
    abrir();
  };

  const alVolver = () => {
    if (document.visibilityState === 'visible' && st().listaCargada) void refrescarTodo();
  };
  const alRecuperarRed = () => { reabrir(); };
  const alPerderRed = () => { st().setConexion('sin_conexion'); };

  document.addEventListener('visibilitychange', alVolver);
  window.addEventListener('online', alRecuperarRed);
  window.addEventListener('offline', alPerderRed);
  abrir();

  return () => {
    detenido = true;
    window.clearTimeout(vigilante);
    document.removeEventListener('visibilitychange', alVolver);
    window.removeEventListener('online', alRecuperarRed);
    window.removeEventListener('offline', alPerderRed);
    if (canal) void supabase.removeChannel(canal);
    canal = null;
    st().reset();
  };
}
