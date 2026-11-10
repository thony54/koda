/**
 * Orden y mezcla de la bandeja: funciones PURAS (sin React ni Supabase) para que los chats queden siempre en el mismo
 * orden sin importar si el dato llegó por Realtime, por una recarga o por las dos a la vez.
 *
 * Reglas:
 *   · Cada fila se identifica por `id`; si llega dos veces gana la versión MÁS NUEVA (`actualizado_at` / `updated_at`).
 *   · Los mensajes se ordenan por hora (`ts`) y, si empatan, por `seq` (orden de inserción).
 *   · Las conversaciones, por la hora de su último mensaje (más reciente arriba).
 *   · Una respuesta local («pendiente») se reemplaza por la fila real cuando llega, reconociéndola por `client_id`.
 */
import type { Conversacion, EnvioMini, EstadoMensaje, Mensaje } from '@/lib/data/bandeja';

export const tiempo = (s: string | null | undefined): number => {
  if (!s) return 0;
  const n = Date.parse(s);
  return Number.isNaN(n) ? 0 : n;
};

export function compararMensajes(a: Mensaje, b: Mensaje): number {
  const d = tiempo(a.ts) - tiempo(b.ts);
  if (d !== 0) return d;
  return a.seq - b.seq;
}

export function compararConversaciones(a: Conversacion, b: Conversacion): number {
  const d = tiempo(b.ultimo_mensaje_at) - tiempo(a.ultimo_mensaje_at);
  if (d !== 0) return d;
  // Sin mensajes o con la misma hora: la más nueva primero, y por id para que el orden nunca «baile».
  const c = tiempo(b.created_at) - tiempo(a.created_at);
  return c !== 0 ? c : a.id.localeCompare(b.id);
}

/** ¿`nuevo` es más reciente (o igual) que `actual`? Sin marca de versión, manda el que llega. */
const esMasNuevo = (nuevo: string | undefined, actual: string | undefined): boolean => {
  if (!nuevo || !actual) return true;
  return tiempo(nuevo) >= tiempo(actual);
};

// ── Mensajes ────────────────────────────────────────────────────────────────

/** Inserta o actualiza UN mensaje. Devuelve la MISMA lista si no cambia nada (evita repintar). */
export function fusionarMensaje(lista: Mensaje[], m: Mensaje): Mensaje[] {
  // 1) La fila real de una respuesta local: se reemplaza la local (mismo client_id).
  let i = lista.findIndex((x) => x.id === m.id);
  if (i < 0 && m.client_id) i = lista.findIndex((x) => x.pendiente && x.client_id === m.client_id);

  if (i >= 0) {
    const actual = lista[i];
    const esLocal = actual.pendiente === true && actual.id !== m.id;
    if (!esLocal && !esMasNuevo(m.actualizado_at, actual.actualizado_at)) return lista;   // llegó una versión vieja
    if (!esLocal && JSON.stringify(actual) === JSON.stringify(m)) return lista;
    const sig = lista.slice();
    // La vista previa local de un archivo en envío se conserva (llegue primero la fila real o la respuesta de la función).
    sig[i] = { ...m, ...(actual.localUrl && !m.localUrl ? { localUrl: actual.localUrl } : {}) };
    return sig.sort(compararMensajes);
  }
  return [...lista, { ...m }].sort(compararMensajes);
}

export function fusionarMensajes(lista: Mensaje[], nuevos: Mensaje[]): Mensaje[] {
  let out = lista;
  for (const m of nuevos) out = fusionarMensaje(out, m);
  return out;
}

/** Hora para una respuesta local: la actual, pero nunca antes del último mensaje visible (relojes distintos). */
export function tsRespuestaLocal(lista: Mensaje[], ahora = Date.now()): string {
  const ultimo = lista.reduce((mx, m) => Math.max(mx, tiempo(m.ts)), 0);
  return new Date(Math.max(ahora, ultimo + 1)).toISOString();
}

// ── Conversaciones ──────────────────────────────────────────────────────────

/** Inserta o actualiza UNA conversación conservando los datos del envío ya cargados. */
export function fusionarConversacion(lista: Conversacion[], c: Conversacion): Conversacion[] {
  const i = lista.findIndex((x) => x.id === c.id);
  if (i < 0) return [...lista, { ...c }].sort(compararConversaciones);
  const actual = lista[i];
  if (!esMasNuevo(c.updated_at, actual.updated_at)) return lista;
  // El envío viaja aparte: se conserva mientras el vínculo no cambie.
  const envio = c.envio !== undefined ? c.envio : actual.envio_id === c.envio_id ? actual.envio : undefined;
  const sig = lista.slice();
  sig[i] = { ...c, envio };
  return sig.sort(compararConversaciones);
}

export function fusionarConversaciones(lista: Conversacion[], nuevas: Conversacion[]): Conversacion[] {
  let out = lista;
  for (const c of nuevas) out = fusionarConversacion(out, c);
  return out;
}

export function aplicarEnvios(lista: Conversacion[], envios: EnvioMini[]): Conversacion[] {
  if (!envios.length) return lista;
  const porId = new Map(envios.map((e) => [e.id, e]));
  return lista.map((c) => (c.envio_id && porId.has(c.envio_id) ? { ...c, envio: porId.get(c.envio_id) } : c));
}

/** Conversaciones cuyo envío todavía no se ha traído. */
export const enviosFaltantes = (lista: Conversacion[]): string[] =>
  [...new Set(lista.filter((c) => c.envio_id && c.envio === undefined).map((c) => c.envio_id as string))];

export const totalNoLeidos = (lista: Conversacion[]): number =>
  lista.reduce((n, c) => n + (c.archivada ? 0 : c.no_leidos), 0);

// ── Filtros de la lista ─────────────────────────────────────────────────────

export type FiltroLista = 'respuestas' | 'no_leidas' | 'sin_respuesta' | 'archivadas';

/** Nombre a mostrar: el negocio de KODA, si no el nombre de su WhatsApp, si no el celular. */
export const tituloConversacion = (c: Pick<Conversacion, 'negocio' | 'envio' | 'nombre_perfil' | 'wa_id'>): string =>
  c.envio?.prospect_nombre?.trim() || c.negocio?.trim() || c.nombre_perfil?.trim() || `+${c.wa_id}`;

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filtrarConversaciones(lista: Conversacion[], filtro: FiltroLista, busqueda: string): Conversacion[] {
  const q = sinTildes(busqueda.trim());
  return lista.filter((c) => {
    // Al buscar se mira en TODOS los chats (incluso archivados): si escribes un nombre, lo encuentras estés en el filtro que estés.
    if (!q) {
      if (filtro === 'archivadas') { if (!c.archivada) return false; }
      else if (c.archivada) return false;
      else if (filtro === 'respuestas' && !c.ultimo_entrante_at) return false;
      else if (filtro === 'no_leidas' && c.no_leidos <= 0) return false;
      else if (filtro === 'sin_respuesta' && c.ultimo_entrante_at) return false;
      return true;
    }
    const pajar = sinTildes([tituloConversacion(c), c.nombre_perfil ?? '', c.wa_id, c.ultimo_texto ?? ''].join(' '));
    return pajar.includes(q.replace(/^\+/, ''));
  });
}

// ── Ventana de 24 horas ─────────────────────────────────────────────────────

const VENTANA_MS = 24 * 3600_000;
export function ventana(c: Pick<Conversacion, 'ultimo_entrante_at'>, ahora = Date.now()): { abierta: boolean; restanteMs: number } {
  if (!c.ultimo_entrante_at) return { abierta: false, restanteMs: 0 };
  const restante = tiempo(c.ultimo_entrante_at) + VENTANA_MS - ahora;
  return { abierta: restante > 0, restanteMs: Math.max(0, restante) };
}

export function textoRestante(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ── Reacciones y separadores de día ─────────────────────────────────────────

export interface Reacciones { entrante?: string; saliente?: string }

/** Las reacciones no son burbujas: se muestran pegadas al mensaje al que reaccionan (la última de cada lado; vacía = la quitó). */
export function separarReacciones(mensajes: Mensaje[]): { visibles: Mensaje[]; reacciones: Map<string, Reacciones> } {
  const reacciones = new Map<string, Reacciones>();
  const visibles: Mensaje[] = [];
  for (const m of mensajes) {
    if (m.tipo !== 'reaction') { visibles.push(m); continue; }
    if (!m.responde_a) continue;
    const r = reacciones.get(m.responde_a) ?? {};
    const emoji = (m.texto ?? '').trim();
    if (emoji) r[m.direccion] = emoji; else delete r[m.direccion];
    reacciones.set(m.responde_a, r);
  }
  return { visibles, reacciones };
}

export type ItemHilo =
  | { tipo: 'dia'; clave: string; ts: string }
  | { tipo: 'mensaje'; m: Mensaje; primero: boolean; ultimo: boolean };

/** Día local (aaaa-mm-dd) de una hora. */
export const claveDia = (ts: string): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Hilo listo para pintar: separadores de día y mensajes agrupados por quién escribe (burbujas seguidas del mismo lado). */
export function armarHilo(mensajes: Mensaje[]): ItemHilo[] {
  const out: ItemHilo[] = [];
  let diaActual = '';
  for (let i = 0; i < mensajes.length; i++) {
    const m = mensajes[i];
    const dia = claveDia(m.ts);
    if (dia !== diaActual) { out.push({ tipo: 'dia', clave: dia, ts: m.ts }); diaActual = dia; }
    const prev = mensajes[i - 1];
    const sig = mensajes[i + 1];
    const mismoGrupo = (x?: Mensaje) => !!x && x.direccion === m.direccion && claveDia(x.ts) === dia && Math.abs(tiempo(x.ts) - tiempo(m.ts)) < 5 * 60_000;
    out.push({ tipo: 'mensaje', m, primero: !mismoGrupo(prev), ultimo: !mismoGrupo(sig) });
  }
  return out;
}

// ── Estados de un mensaje saliente ──────────────────────────────────────────

export const rangoEstado = (e: EstadoMensaje | null | undefined): number =>
  ({ enviando: 0, recibido: 0, enviado: 1, entregado: 2, leido: 3, fallido: 4 } as Record<string, number>)[e ?? ''] ?? 0;

// ── Texto con formato de WhatsApp ───────────────────────────────────────────

export type ParteTexto =
  | { t: 'txt'; v: string }
  | { t: 'url'; v: string; href: string }
  | { t: 'b' | 'i' | 's' | 'code'; v: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
// *negrita*, _cursiva_, ~tachado~, `mono`: el marcador abre tras un espacio/signo y cierra antes de un espacio/signo.
const FORMATO_RE = /(^|[\s(¿¡])([*_~`])(?=\S)([^\n]*?\S)\2(?=$|[\s).,;:!?])/g;
const TIPO_MARCA: Record<string, 'b' | 'i' | 's' | 'code'> = { '*': 'b', '_': 'i', '~': 's', '`': 'code' };

function conFormato(texto: string): ParteTexto[] {
  const out: ParteTexto[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(FORMATO_RE)) {
    const inicio = (m.index ?? 0) + m[1].length;
    if (inicio > ultimo) out.push({ t: 'txt', v: texto.slice(ultimo, inicio) });
    out.push({ t: TIPO_MARCA[m[2]], v: m[3] });
    ultimo = inicio + m[2].length + m[3].length + m[2].length;
  }
  if (ultimo < texto.length) out.push({ t: 'txt', v: texto.slice(ultimo) });
  return out;
}

/** Enlaces clicables y formato de WhatsApp. Nunca devuelve HTML: React escapa todo. Solo http(s). */
export function partesDeTexto(texto: string): ParteTexto[] {
  const out: ParteTexto[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(URL_RE)) {
    const inicio = m.index ?? 0;
    // La puntuación final («…ejemplo.com.») no es parte del enlace.
    const url = m[0].replace(/[.,;:!?)\]]+$/, '');
    if (inicio > ultimo) out.push(...conFormato(texto.slice(ultimo, inicio)));
    out.push({ t: 'url', v: url, href: url });
    ultimo = inicio + url.length;
  }
  if (ultimo < texto.length) out.push(...conFormato(texto.slice(ultimo)));
  return out;
}
