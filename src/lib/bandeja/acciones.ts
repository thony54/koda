/**
 * Operaciones de la bandeja sobre el store: cargar, abrir un chat, paginar, marcar leído y responder.
 * Todo mezcla con las funciones de `orden.ts` (idempotentes y con versión), así da igual si un dato llega por Realtime,
 * por una recarga o por las dos a la vez.
 */
import {
  archivarConversacion, LIMITE_HILO, listConversaciones, listEnviosMini, listMensajes, marcarLeida, marcarNoLeida,
  reintentarArchivo, responderMensaje, subirArchivo, type MediaEnvio, type Mensaje, type RespuestaEnvio,
} from '@/lib/data/bandeja';
import { extensionDe, type ArchivoListo } from '@/lib/bandeja/medios';
import { tsRespuestaLocal } from '@/lib/bandeja/orden';
import { enviosFaltantes, useBandejaStore } from '@/store/bandejaStore';

const st = () => useBandejaStore.getState();
const mensajeDe = (e: unknown, defecto: string) => (e instanceof Error && e.message ? e.message : defecto);

// ── Lista de chats ──────────────────────────────────────────────────────────

let pidiendoEnvios = false;
/** Trae los datos del envío de Connexo (negocio, rubro, estado…) de los chats que aún no los tienen. */
export async function completarEnvios(): Promise<void> {
  if (pidiendoEnvios) return;
  const ids = enviosFaltantes(st().conversaciones);
  if (!ids.length) return;
  pidiendoEnvios = true;
  try {
    const envios = await listEnviosMini(ids);
    st().ponerEnvios(envios, ids);
  } catch (e) {
    console.warn('[bandeja] no se pudieron traer los envíos:', mensajeDe(e, ''));
  } finally {
    pidiendoEnvios = false;
  }
  // Pudo llegar un chat nuevo mientras tanto.
  if (enviosFaltantes(st().conversaciones).length) void completarEnvios();
}

export async function cargarLista(): Promise<void> {
  st().setLista({ cargandoLista: true });
  try {
    const lista = await listConversaciones();
    st().fusionarConvs(lista);
    st().setLista({ listaCargada: true, errorLista: null, cargandoLista: false });
    void completarEnvios();
  } catch (e) {
    st().setLista({ errorLista: mensajeDe(e, 'No se pudo cargar la bandeja.'), cargandoLista: false });
  }
}

// ── Un chat ─────────────────────────────────────────────────────────────────

/** Abre un chat: trae los 100 mensajes más recientes (una sola vez; después el chat se mantiene al día en vivo). */
export async function abrirHilo(convId: string, forzar = false): Promise<void> {
  const h = st().hilos[convId];
  if (!forzar && (h?.cargado || h?.cargando)) return;
  st().ponerHilo(convId, { cargando: true, error: null });
  try {
    const fresh = await listMensajes(convId);
    st().fusionarMsgs(convId, fresh);
    // `hayMas` solo se decide la primera vez: una recarga posterior no sabe si ya se pidieron los viejos.
    st().ponerHilo(convId, { cargando: false, cargado: true, ...(h?.cargado ? {} : { hayMas: fresh.length >= LIMITE_HILO }) });
  } catch (e) {
    st().ponerHilo(convId, { cargando: false, error: mensajeDe(e, 'No se pudieron cargar los mensajes.') });
  }
}

export async function cargarAnteriores(convId: string): Promise<void> {
  const h = st().hilos[convId];
  if (!h || h.cargandoMas || !h.hayMas) return;
  const primero = h.mensajes.find((m) => !m.pendiente);
  if (!primero) return;
  st().ponerHilo(convId, { cargandoMas: true });
  try {
    const fresh = await listMensajes(convId, { ts: primero.ts, seq: primero.seq });
    st().fusionarMsgs(convId, fresh);
    st().ponerHilo(convId, { cargandoMas: false, hayMas: fresh.length >= LIMITE_HILO });
  } catch (e) {
    st().ponerHilo(convId, { cargandoMas: false });
    st().ponerHilo(convId, { error: mensajeDe(e, 'No se pudieron cargar los anteriores.') });
  }
}

/**
 * Tras reconectar (o volver a la pestaña): recarga la lista y el chat abierto, y suelta los demás chats cargados para
 * que se vuelvan a pedir al abrirlos (pudieron perderse avisos mientras no había conexión).
 */
export async function refrescarTodo(): Promise<void> {
  const abierta = st().convAbierta;
  st().soltarHilos((id, h) => id === abierta || h.mensajes.some((m) => m.pendiente));
  await Promise.all([cargarLista(), abierta ? abrirHilo(abierta, true) : Promise.resolve()]);
}

// ── Marcar / archivar ───────────────────────────────────────────────────────

export async function marcarComoLeida(convId: string): Promise<void> {
  const c = st().conversaciones.find((x) => x.id === convId);
  if (!c || c.no_leidos === 0) return;
  st().actualizarConv(convId, { no_leidos: 0 });                 // al instante; Realtime lo confirma
  try { await marcarLeida(convId); } catch { void cargarLista(); }
}
export async function marcarComoNoLeida(convId: string): Promise<void> {
  st().actualizarConv(convId, { no_leidos: 1 });
  try { await marcarNoLeida(convId); } catch { void cargarLista(); }
}
export async function archivar(convId: string, valor: boolean): Promise<void> {
  st().actualizarConv(convId, { archivada: valor });
  try { await archivarConversacion(convId, valor); } catch { void cargarLista(); }
}

// ── Responder ───────────────────────────────────────────────────────────────

export interface ResultadoEnvio { ok: boolean; error?: string; incierto?: boolean; rechazado?: boolean }

/** Pone el mensaje local como fallido SIN servidor (no llegó): se reintenta con el MISMO client_id, que es idempotente. */
function fallarLocal(convId: string, id: string, error: string) {
  st().actualizarMsg(convId, id, { estado: 'fallido', error, local: true, pendiente: true });
}

async function procesarEnvio(
  convId: string,
  clave: {
    id: string; texto: string; clientId: string; reintentarId?: string | null; respondeA?: string | null; forzar?: boolean;
    tipo?: 'image' | 'audio' | 'video' | 'document'; media?: MediaEnvio | null; borradorId?: string | null;
  },
): Promise<ResultadoEnvio> {
  let r: RespuestaEnvio;
  try {
    r = await responderMensaje({
      conversacionId: convId, texto: clave.texto, clientId: clave.clientId, reintentarId: clave.reintentarId, respondeA: clave.respondeA, forzar: clave.forzar,
      tipo: clave.tipo, media: clave.media, borradorId: clave.borradorId,
    });
  } catch (e) {
    const msg = `No se pudo contactar con KODA (${mensajeDe(e, 'sin conexión')}). Reintenta: no se enviará dos veces.`;
    fallarLocal(convId, clave.id, msg);
    return { ok: false, error: msg };
  }

  if (!r.id) {
    // El servidor lo RECHAZÓ antes de registrarlo (ventana cerrada, baja, texto vacío…): no hay mensaje que mostrar.
    st().quitarMsg(convId, clave.id);
    return { ok: false, error: r.error ?? 'No se pudo enviar.', rechazado: true };
  }

  // Si el aviso en vivo aún no trajo la fila real, se completa aquí y se recarga el chat para traerla.
  const actual = st().hilos[convId]?.mensajes.find((m) => m.id === clave.id);
  if (actual) {
    st().actualizarMsg(convId, clave.id, {
      id: r.id, wamid: r.wamid ?? actual.wamid, estado: r.estado ?? actual.estado, pendiente: false, local: false, error: r.ok ? null : (r.error ?? null),
    });
    void abrirHilo(convId, true);
  }
  return { ok: r.ok, error: r.error, incierto: r.incierto };
}

/** Responde con texto libre. El mensaje aparece al instante («enviando») y se confirma solo (✓ → ✓✓ → leído). */
export async function enviarTexto(
  convId: string, texto: string, respondeA?: string | null, forzar = false, borradorId?: string | null,
): Promise<ResultadoEnvio> {
  const limpio = texto.trim();
  if (!limpio) return { ok: false, error: 'Escribe un mensaje.', rechazado: true };
  const clientId = crypto.randomUUID();
  const ts = tsRespuestaLocal(st().hilos[convId]?.mensajes ?? []);
  const local: Mensaje = {
    id: `tmp-${clientId}`, seq: Number.MAX_SAFE_INTEGER, conversacion_id: convId, wamid: null, client_id: clientId,
    direccion: 'saliente', tipo: 'text', texto: limpio, media: null, extra: forzar ? { forzado: true } : null, responde_a: respondeA ?? null,
    estado: 'enviando', error: null, ts, created_at: ts, actualizado_at: ts, pendiente: true,
  };
  st().fusionarMsg(local);
  return procesarEnvio(convId, { id: local.id, texto: limpio, clientId, respondeA, forzar, borradorId });
}

// ── Archivos (fotos, audios, video, documentos) ──────────────────────────────

/** Archivos que aún no llegaron al servidor: si la subida falla, «Reintentar» los vuelve a subir sin pedir elegirlos otra vez. */
const PENDIENTES = new Map<string, ArchivoListo>();

async function subirYEnviar(
  convId: string, id: string, clientId: string, a: ArchivoListo, caption: string, respondeA: string | null | undefined, forzar: boolean,
): Promise<ResultadoEnvio> {
  let path: string;
  try {
    path = await subirArchivo(convId, clientId, a.blob, a.mime, extensionDe(a.mime));
  } catch (e) {
    const msg = `No se pudo subir el archivo (${mensajeDe(e, 'sin conexión')}). Reintenta.`;
    fallarLocal(convId, id, msg);
    return { ok: false, error: msg };
  }
  const r = await procesarEnvio(convId, {
    id, texto: caption, clientId, respondeA, forzar, tipo: a.tipo,
    media: { path, mime: a.mime, nombre: a.nombre, bytes: a.bytes, voz: a.voz },
  });
  // Si el servidor ya lo conoce (enviado, rechazado o fallido allá) el archivo local sobra; si no llegó, se conserva para reintentar.
  if (!st().hilos[convId]?.mensajes.find((m) => m.id === id)?.local) PENDIENTES.delete(clientId);
  return r;
}

/** Envía una foto, audio, video o documento. Aparece al instante («enviando») con su vista previa y se confirma solo. */
export async function enviarArchivo(
  convId: string, a: ArchivoListo, pie = '', respondeA?: string | null, forzar = false,
): Promise<ResultadoEnvio> {
  const clientId = crypto.randomUUID();
  const ts = tsRespuestaLocal(st().hilos[convId]?.mensajes ?? []);
  const texto = a.tipo === 'audio' ? null : (pie.trim() || null);
  const local: Mensaje = {
    id: `tmp-${clientId}`, seq: Number.MAX_SAFE_INTEGER, conversacion_id: convId, wamid: null, client_id: clientId,
    direccion: 'saliente', tipo: a.tipo, texto, media: { mime: a.mime, nombre: a.nombre, bytes: a.bytes, voz: a.voz, estado: 'pendiente' },
    extra: forzar ? { forzado: true } : null, responde_a: respondeA ?? null,
    estado: 'enviando', error: null, ts, created_at: ts, actualizado_at: ts, pendiente: true, localUrl: URL.createObjectURL(a.blob),
  };
  PENDIENTES.set(clientId, a);
  st().fusionarMsg(local);
  return subirYEnviar(convId, local.id, clientId, a, texto ?? '', respondeA, forzar);
}

/** Reintenta un mensaje que falló. Uno que nunca llegó al servidor se reenvía con el mismo client_id; uno «fallido» o sin confirmar, sobre su misma fila. */
export async function reintentarEnvio(m: Mensaje): Promise<ResultadoEnvio> {
  const convId = m.conversacion_id;
  const texto = m.texto ?? '';
  const forzar = (m.extra as { forzado?: boolean } | null)?.forzado === true;      // un intento forzado se reintenta igual
  if (m.local && m.client_id && m.tipo !== 'text') {
    // Un archivo que no llegó a subirse: se vuelve a subir (mismo nombre → lo reemplaza) y se envía con el MISMO client_id.
    const archivo = PENDIENTES.get(m.client_id);
    if (!archivo) return { ok: false, error: 'El archivo ya no está en memoria: vuelve a adjuntarlo.', rechazado: true };
    st().actualizarMsg(convId, m.id, { estado: 'enviando', error: null, local: false });
    return subirYEnviar(convId, m.id, m.client_id, archivo, texto, m.responde_a, forzar);
  }
  if (m.local && m.client_id) {
    st().actualizarMsg(convId, m.id, { estado: 'enviando', error: null, local: false });
    return procesarEnvio(convId, { id: m.id, texto, clientId: m.client_id, respondeA: m.responde_a, forzar });
  }
  const anterior = { estado: m.estado, error: m.error };
  st().actualizarMsg(convId, m.id, { estado: 'enviando', error: null });
  const r = await procesarEnvio(convId, { id: m.id, texto, clientId: crypto.randomUUID(), reintentarId: m.id, respondeA: m.responde_a, forzar });
  if (r.rechazado) { st().actualizarMsg(convId, m.id, anterior); void abrirHilo(convId, true); }
  return r;
}

export async function reintentarDescarga(m: Mensaje): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await reintentarArchivo(m.id);
    void abrirHilo(m.conversacion_id, true);
    return r;
  } catch (e) {
    return { ok: false, error: mensajeDe(e, 'No se pudo bajar el archivo.') };
  }
}
