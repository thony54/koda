// Responder desde la bandeja de WhatsApp (migración 0016). Puro y probado con Node + Postgres real (ver waBandeja.ts).
import { BUCKET_MEDIA, type BandejaDb, type Json, type LlamarWa } from './waBandeja.ts';

export type TipoEnvio = 'text' | 'image' | 'audio' | 'video' | 'document';

/** Lo que WhatsApp acepta enviar por tipo (Cloud API). Un .webp o .gif NO vale como foto: la pantalla los convierte antes. */
export const MIME_ENVIO: Record<Exclude<TipoEnvio, 'text'>, RegExp> = {
  image: /^image\/(jpeg|png)$/,
  audio: /^audio\/(aac|mp4|mpeg|amr|ogg)$/,
  video: /^video\/(mp4|3gpp)$/,
  document: /^(application\/(pdf|msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))|text\/plain)$/,
};
export const MAX_BYTES_ENVIO: Record<Exclude<TipoEnvio, 'text'>, number> = {
  image: 5 * 1024 * 1024, audio: 16 * 1024 * 1024, video: 16 * 1024 * 1024, document: 16 * 1024 * 1024,
};

export interface MediaPedida {
  path: string;
  mime: string;
  nombre?: string | null;
  bytes?: number | null;
  /** Nota de voz grabada en la pantalla (solo cambia cómo se muestra el chat). */
  voz?: boolean;
}

export interface RespuestaPedida {
  conversacion_id: string;
  texto: string;
  /** Lo genera la pantalla por cada envío: reintentar la MISMA petición nunca manda un segundo mensaje. */
  client_id: string;
  /** Mensaje que quedó «fallido» (o sin confirmar) y se quiere reenviar: se reutiliza su fila. */
  reintentar_id?: string | null;
  /** wamid del mensaje al que se responde (cita). */
  responde_a?: string | null;
  /** «Intentar responder igual»: no se comprueba la ventana de 24 h localmente (Meta decide). La baja nunca se salta. */
  forzar?: boolean;
  /** Por defecto 'text'. Para fotos, audios, video y documentos: el archivo ya está en el bucket (`media.path`) y `texto` es el pie. */
  tipo?: TipoEnvio;
  media?: MediaPedida | null;
  /** Quién envía (el propietario). NULL cuando responde el agente en modo automático. */
  usuario: string | null;
}
export interface RespuestaResultado {
  ok: boolean;
  id?: string;
  estado?: string;
  wamid?: string | null;
  /** El envío ya estaba en marcha (mismo client_id): no se vuelve a mandar. */
  en_curso?: boolean;
  /** No se sabe si Meta lo recibió (tiempo agotado o caída): puede haber salido. Se resuelve solo con el aviso de Meta. */
  incierto?: boolean;
  error?: string;
  codigo?: 'ventana_cerrada' | 'baja' | 'regla' | 'meta';
}

/**
 * Responde con texto libre: (1) registra la respuesta «enviando» y comprueba las reglas, (2) la manda a Meta por
 * Connexo, (3) guarda el id de Meta o el fallo. Cada paso deja la bandeja en un estado coherente aunque el siguiente
 * se corte. Un error DEFINITIVO de Meta (4xx) deja el mensaje «fallido» con botón de reintentar; uno INCIERTO (tiempo
 * agotado, caída de red, 5xx) lo deja «enviando»: pudo salir, y el aviso de Meta —que trae el client_id— lo resuelve.
 */
export async function responderDesdeBandeja(db: BandejaDb, llamarWa: LlamarWa, p: RespuestaPedida): Promise<RespuestaResultado> {
  const tipo: TipoEnvio = p.tipo ?? 'text';
  // Un archivo NUEVO se valida antes de registrar nada (en un reintento el archivo ya está registrado en su fila).
  if (tipo !== 'text' && !p.reintentar_id) {
    const m = p.media;
    if (!(tipo in MIME_ENVIO)) return { ok: false, error: 'Tipo de mensaje no admitido.', codigo: 'regla' };
    if (!m || typeof m.path !== 'string' || !m.path.startsWith(`enviados/${p.conversacion_id}/`)) {
      return { ok: false, error: 'Falta el archivo a enviar.', codigo: 'regla' };
    }
    const mime = String(m.mime ?? '').split(';')[0].trim().toLowerCase();
    if (!MIME_ENVIO[tipo].test(mime)) {
      return { ok: false, error: 'WhatsApp no admite ese formato de archivo. Usa JPG o PNG para fotos, MP3/M4A/OGG para audios, MP4 para video o PDF/Office para documentos.', codigo: 'regla' };
    }
    if (typeof m.bytes === 'number' && m.bytes > MAX_BYTES_ENVIO[tipo]) {
      return { ok: false, error: `El archivo pesa demasiado (máximo ${Math.round(MAX_BYTES_ENVIO[tipo] / 1048576)} MB para ese tipo).`, codigo: 'regla' };
    }
  }
  const prep = await db.rpc('wa_enviar_preparar', {
    p_conv: p.conversacion_id, p_texto: p.texto, p_client: p.client_id, p_user: p.usuario,
    p_reintentar: p.reintentar_id ?? null, p_responde_a: p.responde_a ?? null, p_forzar: p.forzar === true,
    p_tipo: tipo, p_media: tipo === 'text' ? null : (p.media ?? null),
  });
  if (prep.error) {
    // Las reglas (ventana de 24 h, baja, texto vacío…) llegan como excepción P0001 con el motivo ya en español.
    if (prep.error.code !== 'P0001') throw new Error(prep.error.message);
    const msg = prep.error.message;
    const m = /^(ventana_cerrada|baja): ?([\s\S]*)$/.exec(msg);
    return { ok: false, error: m ? m[2] : msg, codigo: m ? (m[1] as 'ventana_cerrada' | 'baja') : 'regla' };
  }
  const f = prep.data as Json;

  // Reintento de una petición que ya se registró: no se vuelve a mandar a Meta.
  if (f.ya_existia) {
    if (f.estado === 'fallido') return { ok: false, id: f.id, estado: f.estado, error: 'Ese envío ya había fallado: usa «Reintentar».', codigo: 'meta' };
    return { ok: true, id: f.id, estado: f.estado, wamid: f.wamid ?? null, en_curso: f.estado === 'enviando' };
  }

  try {
    const base: Json = { action: 'responder', to: f.wa_id, client_id: p.client_id, context_wamid: f.responde_a ?? null };
    if (f.tipo && f.tipo !== 'text') {
      // Meta baja el archivo de un enlace firmado de corta vida: el bucket sigue privado.
      const url = await db.storage.from(BUCKET_MEDIA).createSignedUrl(String(f.media?.path ?? ''), 900);
      if (url.error || !url.data?.signedUrl) {
        const msg = 'El archivo no está disponible: vuelve a subirlo.';
        await db.rpc('wa_enviar_fallo', { p_id: f.id, p_error: msg });
        return { ok: false, id: f.id, estado: 'fallido', error: msg, codigo: 'meta' };
      }
      Object.assign(base, { tipo: f.tipo, link: url.data.signedUrl, texto: f.texto ?? null, nombre: f.media?.nombre ?? null, mime: f.media?.mime ?? null });
    } else {
      Object.assign(base, { tipo: 'text', texto: f.texto });
    }
    const r = await llamarWa(base, 40_000);
    if (typeof r.wamid !== 'string' || !r.wamid) throw new Error('Meta no devolvió el id del mensaje.');
    const c = await db.rpc('wa_enviar_confirmar', { p_id: f.id, p_wamid: r.wamid });
    if (c.error) {
      // Ya salió: no se marca fallido. El aviso de Meta (con este client_id) completa el id.
      console.error('[wa-bandeja] no se guardó el wamid:', c.error.message);
      return { ok: true, id: f.id, estado: 'enviando', wamid: r.wamid, incierto: true };
    }
    return { ok: true, id: f.id, estado: 'enviado', wamid: r.wamid };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = (e as { status?: number | null }).status ?? null;
    if (status !== null && status >= 400 && status < 500) {
      await db.rpc('wa_enviar_fallo', { p_id: f.id, p_error: msg });
      return { ok: false, id: f.id, estado: 'fallido', error: msg, codigo: 'meta' };
    }
    return {
      ok: false, id: f.id, estado: 'enviando', incierto: true, codigo: 'meta',
      error: `No pude confirmar que Meta recibió el mensaje (${msg}). Puede haber salido: espera unos segundos antes de reenviarlo.`,
    };
  }
}
