/**
 * Bandeja de WhatsApp de Connexo (migración 0016). Leer es una consulta normal (RLS: solo el propietario);
 * responder y bajar archivos pasa por la Edge Function `koda-connexo`; marcar leído / archivar son RPC.
 */
import { db, supabase } from '@/lib/supabase';
import { invokeConnexo } from '@/lib/data/connexo';

export type EstadoMensaje = 'enviando' | 'enviado' | 'entregado' | 'leido' | 'fallido' | 'recibido';
export type TipoMensaje =
  | 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'contacts'
  | 'reaction' | 'button' | 'interactive' | 'template' | 'unsupported';

export interface ArchivoMensaje {
  id?: string | null;
  mime?: string | null;
  sha256?: string | null;
  nombre?: string;
  voz?: boolean;
  path?: string;
  bytes?: number;
  estado?: 'pendiente' | 'guardado' | 'error';
  error?: string | null;
}

export interface EnvioMini {
  id: string;
  estado: string;
  prospect_id: string | null;
  prospect_nombre: string;
  prospect_ciudad: string | null;
  rubro: string | null;
  busqueda_nombre: string | null;
  connexo_username: string | null;
}

export interface Conversacion {
  id: string;
  wa_id: string;
  nombre_perfil: string | null;
  envio_id: string | null;
  prospect_id: string | null;
  negocio: string | null;
  ultimo_mensaje_id: string | null;
  ultimo_mensaje_at: string | null;
  ultimo_dir: 'entrante' | 'saliente' | null;
  ultimo_tipo: string | null;
  ultimo_texto: string | null;
  ultimo_estado: EstadoMensaje | null;
  ultimo_entrante_at: string | null;
  no_leidos: number;
  archivada: boolean;
  created_at: string;
  updated_at: string;
  /** Datos del envío de Connexo (se trae por separado; undefined = aún no cargado). */
  envio?: EnvioMini | null;
}

export interface Mensaje {
  id: string;
  seq: number;
  conversacion_id: string;
  wamid: string | null;
  client_id: string | null;
  direccion: 'entrante' | 'saliente';
  tipo: TipoMensaje;
  texto: string | null;
  media: ArchivoMensaje | null;
  extra: Record<string, unknown> | null;
  responde_a: string | null;
  estado: EstadoMensaje;
  error: string | null;
  ts: string;
  created_at: string;
  actualizado_at: string;
  /** Solo en pantalla: respuesta que aún no confirmó el servidor. */
  pendiente?: boolean;
  /** Solo en pantalla: vista previa local (blob:) del archivo que se está enviando; evita parpadeos hasta que llega el enlace real. */
  localUrl?: string;
  /** Solo en pantalla: falló antes de llegar al servidor (se reintenta con el MISMO client_id: es idempotente). */
  local?: boolean;
}

export const LIMITE_HILO = 100;
const COLUMNAS_ENVIO = 'id, estado, prospect_id, prospect_nombre, prospect_ciudad, rubro, busqueda_nombre, connexo_username';

export async function listConversaciones(): Promise<Conversacion[]> {
  const { data, error } = await db.from('wa_conversaciones')
    .select('*')
    .order('ultimo_mensaje_at', { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as Conversacion[];
}

export async function listEnviosMini(ids: string[]): Promise<EnvioMini[]> {
  if (!ids.length) return [];
  const { data, error } = await db.from('connexo_envios').select(COLUMNAS_ENVIO).in('id', ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as EnvioMini[];
}

/** Los mensajes MÁS RECIENTES de un chat (o los anteriores a `antes`), del más viejo al más nuevo. */
export async function listMensajes(
  conversacionId: string,
  antes?: { ts: string; seq: number },
  limite = LIMITE_HILO,
): Promise<Mensaje[]> {
  let q = db.from('wa_mensajes').select('*')
    .eq('conversacion_id', conversacionId)
    .order('ts', { ascending: false })
    .order('seq', { ascending: false })
    .limit(limite);
  if (antes) q = q.or(`ts.lt.${antes.ts},and(ts.eq.${antes.ts},seq.lt.${antes.seq})`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Mensaje[]).reverse();
}

export async function marcarLeida(conversacionId: string): Promise<void> {
  const { error } = await db.rpc('wa_marcar_leida', { p_conv: conversacionId });
  if (error) throw new Error(error.message);
}
export async function marcarNoLeida(conversacionId: string): Promise<void> {
  const { error } = await db.rpc('wa_marcar_no_leida', { p_conv: conversacionId });
  if (error) throw new Error(error.message);
}
export async function archivarConversacion(conversacionId: string, valor: boolean): Promise<void> {
  const { error } = await db.rpc('wa_archivar', { p_conv: conversacionId, p_valor: valor });
  if (error) throw new Error(error.message);
}

export interface RespuestaEnvio {
  ok: boolean;
  id?: string;
  estado?: EstadoMensaje;
  wamid?: string | null;
  en_curso?: boolean;
  incierto?: boolean;
  error?: string;
  codigo?: 'ventana_cerrada' | 'baja' | 'regla' | 'meta';
}

export interface MediaEnvio {
  path: string;
  mime: string;
  nombre?: string | null;
  bytes?: number | null;
  voz?: boolean;
}

export async function responderMensaje(p: {
  conversacionId: string;
  texto: string;
  clientId: string;
  reintentarId?: string | null;
  respondeA?: string | null;
  forzar?: boolean;
  /** Para fotos, audios, video y documentos: el archivo ya está subido (`media.path`) y `texto` es el pie. */
  tipo?: 'image' | 'audio' | 'video' | 'document';
  media?: MediaEnvio | null;
}): Promise<RespuestaEnvio> {
  return invokeConnexo<RespuestaEnvio>({
    action: 'wa_responder',
    conversacion_id: p.conversacionId,
    texto: p.texto,
    tipo: p.tipo,
    media: p.media ?? undefined,
    client_id: p.clientId,
    reintentar_id: p.reintentarId ?? undefined,
    responde_a: p.respondeA ?? undefined,
    forzar: p.forzar ? true : undefined,
  });
}

/** Baja y guarda el archivo de un mensaje cuyo guardado automático falló. */
export async function reintentarArchivo(mensajeId: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  return invokeConnexo({ action: 'wa_media', mensaje_id: mensajeId });
}

/** Trae a la bandeja los saludos que Connexo ya había enviado (idempotente). */
export async function importarSaludos(): Promise<{ total: number; nuevos: number; duplicados: number; ignorados: number; respuestas?: { nuevos: number } }> {
  return invokeConnexo({ action: 'wa_importar_saludos' });
}

/** Sube el archivo a enviar al bucket privado, bajo la carpeta de ESE chat. El nombre sale del client_id: reintentar lo reemplaza, no lo duplica. */
export async function subirArchivo(conversacionId: string, clientId: string, blob: Blob, mime: string, extension: string): Promise<string> {
  const path = `enviados/${conversacionId}/${clientId}.${extension}`;
  const { error } = await supabase.storage.from('wa-media').upload(path, blob, { contentType: mime, upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

const FIRMADAS = new Map<string, { url: string; vence: number }>();
/** Enlace temporal (1 h) a un archivo guardado. Se reutiliza mientras no esté por vencer. */
export async function urlArchivo(path: string): Promise<string> {
  const hit = FIRMADAS.get(path);
  if (hit && hit.vence > Date.now() + 5 * 60_000) return hit.url;
  const { data, error } = await supabase.storage.from('wa-media').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'No se pudo abrir el archivo.');
  FIRMADAS.set(path, { url: data.signedUrl, vence: Date.now() + 3600_000 });
  return data.signedUrl;
}
