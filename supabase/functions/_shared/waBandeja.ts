// Lógica de la bandeja de WhatsApp (migración 0016) compartida por `koda-wa-inbox` y `koda-connexo`.
//
// Sin dependencias de Deno ni de Supabase a propósito: son funciones puras y la base entra por parámetro
// (`BandejaDb`), así se prueban con Node contra un Postgres real (PGlite) sin tocar nada de producción.

// deno-lint-ignore no-explicit-any
export type Json = Record<string, any>;

/** Lo mínimo del cliente de Supabase que usa la bandeja (el cliente real lo cumple). */
export interface BandejaDb {
  rpc(fn: string, args?: Json): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Uint8Array,
        opts?: { contentType?: string; upsert?: boolean },
      ): PromiseLike<{ error: { message: string } | null }>;
      createSignedUrl(path: string, segundos: number): PromiseLike<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    };
  };
}

export const BUCKET_MEDIA = 'wa-media';
export const MAX_BYTES_MEDIA = 20 * 1024 * 1024;

const TIPOS = new Set([
  'text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contacts', 'reaction', 'button', 'interactive',
]);
const CON_ARCHIVO = new Set(['image', 'audio', 'video', 'document', 'sticker']);

/** Hora de Meta (segundos desde 1970, como texto) → ISO. Sin hora válida devuelve null (la base usa la actual). */
export function isoDeMeta(ts: unknown): string | null {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Mensaje en español para los errores de entrega de Meta que más se ven; el resto se muestra tal cual. */
export function explicarErrorMeta(code: number | null, detalle: string): string {
  switch (code) {
    case 131047: return 'Pasaron más de 24 horas desde el último mensaje del cliente: solo se puede enviar una plantilla.';
    case 131026: return 'Ese número no tiene WhatsApp o no puede recibir el mensaje.';
    case 131049: return 'Meta frenó este mensaje (límite de frecuencia o calidad para ese número).';
    case 131051: return 'Tipo de mensaje no compatible.';
    case 131053: return 'Meta no pudo procesar el archivo.';
    case 130472: return 'El usuario está en un experimento de Meta y no recibe este mensaje.';
    default: return `Meta ${code ?? '?'}: ${detalle || 'no se entregó'}`;
  }
}

const ESTADO_META: Record<string, string> = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallido' };

export interface MensajeNormalizado {
  /** Parámetro `p` de `wa_recibir_mensaje`. */
  params: Json;
  /** Si trae archivo: lo que hace falta para bajarlo de Meta. */
  archivo: { id: string; mime: string | null } | null;
}
export interface EstadoNormalizado {
  wamid: string;
  estado: string;
  ts: string | null;
  error: string | null;
  client: string | null;
}

/**
 * Convierte el payload del webhook de Meta en lo que entiende la base. Solo se toman los eventos del número emisor
 * (`phoneId`): así nunca entra nada de otra cuenta de WhatsApp (p. ej. el celular personal vinculado al portafolio).
 * Sin `phoneId` no se acepta NADA (falla seguro).
 */
export function normalizarEventos(
  payload: unknown,
  phoneId: string | null,
): { mensajes: MensajeNormalizado[]; estados: EstadoNormalizado[]; ignorados: number } {
  const mensajes: MensajeNormalizado[] = [];
  const estados: EstadoNormalizado[] = [];
  let ignorados = 0;
  const entradas = ((payload as Json)?.entry ?? []) as Json[];

  for (const entry of Array.isArray(entradas) ? entradas : []) {
    for (const ch of (Array.isArray(entry?.changes) ? entry.changes : []) as Json[]) {
      const v = (ch?.value ?? {}) as Json;
      const msgs = (Array.isArray(v.messages) ? v.messages : []) as Json[];
      const sts = (Array.isArray(v.statuses) ? v.statuses : []) as Json[];
      if (!phoneId || String(v.metadata?.phone_number_id ?? '') !== phoneId) {
        ignorados += msgs.length + sts.length;
        continue;
      }
      const nombres = new Map<string, string>();
      for (const c of (Array.isArray(v.contacts) ? v.contacts : []) as Json[]) {
        if (c?.wa_id && c?.profile?.name) nombres.set(String(c.wa_id), String(c.profile.name));
      }

      for (const m of msgs) {
        const wa = String(m?.from ?? '').replace(/\D/g, '');
        const wamid = typeof m?.id === 'string' ? m.id : null;
        if (!wa || !wamid) { ignorados++; continue; }
        mensajes.push(normalizarMensaje(m, wa, wamid, nombres.get(wa) ?? null));
      }
      for (const s of sts) {
        const estado = ESTADO_META[String(s?.status ?? '')];
        if (!estado || typeof s?.id !== 'string') continue;
        const e = (Array.isArray(s.errors) ? s.errors[0] : null) as Json | null;
        const code = typeof e?.code === 'number' ? e.code : null;
        estados.push({
          wamid: s.id,
          estado,
          ts: isoDeMeta(s.timestamp),
          error: estado === 'fallido' ? explicarErrorMeta(code, String(e?.error_data?.details ?? e?.message ?? e?.title ?? '')) : null,
          client: typeof s.biz_opaque_callback_data === 'string' && s.biz_opaque_callback_data ? s.biz_opaque_callback_data : null,
        });
      }
    }
  }
  return { mensajes, estados, ignorados };
}

function normalizarMensaje(m: Json, wa: string, wamid: string, nombre: string | null): MensajeNormalizado {
  const tipoMeta = String(m.type ?? '');
  const tipo = TIPOS.has(tipoMeta) ? tipoMeta : 'unsupported';
  const base: Json = {
    wa_id: wa, direccion: 'entrante', wamid, tipo, nombre,
    ts: isoDeMeta(m.timestamp) ?? new Date().toISOString(),
    responde_a: m.context?.id ?? null,
  };
  let archivo: MensajeNormalizado['archivo'] = null;

  switch (tipo) {
    case 'text':
      base.texto = String(m.text?.body ?? '');
      break;
    case 'image': case 'video': case 'audio': case 'document': case 'sticker': {
      const x = (m[tipo] ?? {}) as Json;
      base.texto = typeof x.caption === 'string' ? x.caption : null;
      base.media = {
        id: x.id ?? null, mime: x.mime_type ?? null, sha256: x.sha256 ?? null,
        ...(tipo === 'audio' ? { voz: x.voice === true } : {}),
        ...(tipo === 'document' && x.filename ? { nombre: String(x.filename) } : {}),
        estado: x.id ? 'pendiente' : 'error',
      };
      if (x.id && CON_ARCHIVO.has(tipo)) archivo = { id: String(x.id), mime: x.mime_type ?? null };
      break;
    }
    case 'location': {
      const l = (m.location ?? {}) as Json;
      base.texto = [l.name, l.address].filter(Boolean).join(' · ') || null;
      base.extra = { lat: l.latitude ?? null, lng: l.longitude ?? null, nombre: l.name ?? null, direccion: l.address ?? null };
      break;
    }
    case 'contacts': {
      const lista = (Array.isArray(m.contacts) ? m.contacts : []) as Json[];
      base.extra = {
        contactos: lista.map((c) => ({
          nombre: c?.name?.formatted_name ?? null,
          telefonos: (Array.isArray(c?.phones) ? c.phones : []).map((p: Json) => p?.phone).filter(Boolean),
        })),
      };
      base.texto = lista.map((c) => c?.name?.formatted_name).filter(Boolean).join(', ') || null;
      break;
    }
    case 'reaction':
      base.texto = typeof m.reaction?.emoji === 'string' ? m.reaction.emoji : '';
      base.responde_a = m.reaction?.message_id ?? null;
      break;
    case 'button':
      base.texto = String(m.button?.text ?? '');
      break;
    case 'interactive':
      base.texto = String(
        m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m.interactive?.nfm_reply?.body ?? 'Respuesta',
      );
      break;
    default:
      base.extra = { tipo_meta: tipoMeta || null, errores: Array.isArray(m.errors) ? m.errors.slice(0, 2) : null };
  }
  return { params: base, archivo };
}

// ── Aplicar a la base ───────────────────────────────────────────────────────

export interface ArchivoPorGuardar {
  mensajeId: string;
  conversacionId: string;
  mediaId: string;
  mime: string | null;
}
export interface ResultadoEventos {
  mensajes: number;
  duplicados: number;
  estados: number;
  ignorados: number;
  archivos: ArchivoPorGuardar[];
}

/** Las funciones SQL rechazan con RAISE EXCEPTION (P0001) lo que no procede: eso se anota y se sigue. */
const esReglaDeNegocio = (e: { code?: string }) => e.code === 'P0001';

/**
 * Guarda en la base los mensajes y avisos de estado de un webhook de Meta. Todo es idempotente (por id de Meta):
 * si algo falla se lanza el PRIMER error DESPUÉS de procesar el resto, para que Meta reintente sin perder nada.
 */
export async function aplicarEventos(db: BandejaDb, payload: unknown, phoneId: string | null): Promise<ResultadoEventos> {
  const n = normalizarEventos(payload, phoneId);
  const out: ResultadoEventos = { mensajes: 0, duplicados: 0, estados: 0, ignorados: n.ignorados, archivos: [] };
  let primerError: Error | null = null;
  const anotar = (e: { message: string }) => { primerError ??= new Error(e.message); };

  for (const m of n.mensajes) {
    const r = await db.rpc('wa_recibir_mensaje', { p: m.params });
    if (r.error) {
      if (esReglaDeNegocio(r.error)) { out.ignorados++; console.error('[wa-bandeja] mensaje rechazado:', r.error.message); } else anotar(r.error);
      continue;
    }
    const d = r.data as Json;
    if (d?.duplicado) { out.duplicados++; continue; }
    out.mensajes++;
    if (m.archivo && d?.mensaje_id && d?.conversacion_id) {
      out.archivos.push({ mensajeId: d.mensaje_id, conversacionId: d.conversacion_id, mediaId: m.archivo.id, mime: m.archivo.mime });
    }
  }
  for (const s of n.estados) {
    const r = await db.rpc('wa_registrar_estado', {
      p_wamid: s.wamid, p_estado: s.estado, p_ts: s.ts, p_error: s.error, p_client: s.client,
    });
    if (r.error) {
      if (esReglaDeNegocio(r.error)) { out.ignorados++; console.error('[wa-bandeja] aviso rechazado:', r.error.message); } else anotar(r.error);
      continue;
    }
    out.estados++;
  }
  if (primerError) throw primerError;
  return out;
}

export interface SaludoEnviado {
  wa_id: string;
  wamid: string;
  nombre?: string | null;
  plantilla?: string | null;
  ts?: string | null;
}

/** Registra en la bandeja los saludos (plantilla) que Connexo envió, para que el hilo empiece con ellos. Idempotente. */
export async function registrarSaludos(db: BandejaDb, items: SaludoEnviado[]): Promise<{ nuevos: number; duplicados: number; ignorados: number }> {
  const out = { nuevos: 0, duplicados: 0, ignorados: 0 };
  let primerError: Error | null = null;
  for (const it of items) {
    const wa = String(it?.wa_id ?? '').replace(/\D/g, '');
    if (!/^\d{8,15}$/.test(wa) || typeof it?.wamid !== 'string' || !it.wamid) { out.ignorados++; continue; }
    const r = await db.rpc('wa_recibir_mensaje', {
      p: {
        wa_id: wa, direccion: 'saliente', tipo: 'template', wamid: it.wamid, estado: 'enviado',
        extra: { etiqueta: 'Saludo inicial enviado', plantilla: it.plantilla ?? null, negocio: it.nombre ?? null },
        ts: it.ts ?? new Date().toISOString(),
      },
    });
    if (r.error) {
      if (esReglaDeNegocio(r.error)) out.ignorados++; else primerError ??= new Error(r.error.message);
      continue;
    }
    if ((r.data as Json)?.duplicado) out.duplicados++; else out.nuevos++;
  }
  if (primerError) throw primerError;
  return out;
}

export interface RespuestaPasada {
  wa_id: string;
  /** Id propio (no de Meta) para que importarla dos veces no la duplique, p. ej. `hist:<negocio>:si`. */
  wamid: string;
  /** Lo que respondió: «¡Sí, enviar demo!», «Ver más tarde»… */
  texto: string;
  ts: string;
}

/**
 * Importa lo que los negocios YA habían respondido por botón antes de existir la bandeja (Connexo lo guardó con su hora).
 * Así el chat muestra su respuesta, la bandeja sabe cuándo escribió por última vez (ventana de 24 h) y se puede
 * contestar. Entran como LEÍDAS (no inflan el contador de no leídos). Idempotente.
 */
export async function registrarRespuestasPasadas(db: BandejaDb, items: RespuestaPasada[]): Promise<{ nuevos: number; duplicados: number; ignorados: number }> {
  const out = { nuevos: 0, duplicados: 0, ignorados: 0 };
  let primerError: Error | null = null;
  for (const it of items) {
    const wa = String(it?.wa_id ?? '').replace(/\D/g, '');
    if (!/^\d{8,15}$/.test(wa) || typeof it?.wamid !== 'string' || !it.wamid || !it.texto || !it.ts) { out.ignorados++; continue; }
    const r = await db.rpc('wa_recibir_mensaje', {
      p: { wa_id: wa, direccion: 'entrante', tipo: 'button', wamid: it.wamid, texto: it.texto, ts: it.ts, leido: true },
    });
    if (r.error) {
      if (esReglaDeNegocio(r.error)) out.ignorados++; else primerError ??= new Error(r.error.message);
      continue;
    }
    if ((r.data as Json)?.duplicado) out.duplicados++; else out.nuevos++;
  }
  if (primerError) throw primerError;
  return out;
}

// ── Archivos del cliente ────────────────────────────────────────────────────

const EXT_POR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'application/pdf': 'pdf', 'text/plain': 'txt',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};
export const extensionDe = (mime: string | null | undefined): string => {
  const base = String(mime ?? '').split(';')[0].trim().toLowerCase();
  return EXT_POR_MIME[base] ?? 'bin';
};

export function decodificarBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type LlamarWa = (body: Json, timeoutMs?: number) => Promise<Json>;

/**
 * Baja el archivo de Meta (a través de Connexo, que es quien tiene el token) y lo guarda en el bucket privado.
 * Anota el resultado en el mensaje (`media.estado` = guardado | error) y lo devuelve. NUNCA lanza: un archivo que no
 * baja no debe tumbar el mensaje (el texto ya está guardado y se puede reintentar desde la pantalla).
 */
export async function guardarArchivo(
  db: BandejaDb,
  llamarWa: LlamarWa,
  a: ArchivoPorGuardar,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const r = await llamarWa({ action: 'media', media_id: a.mediaId }, 60_000);
    if (typeof r.bytes !== 'string' || !r.bytes) throw new Error('Connexo no devolvió el archivo.');
    const datos = decodificarBase64(r.bytes);
    if (datos.length === 0) throw new Error('El archivo llegó vacío.');
    if (datos.length > MAX_BYTES_MEDIA) throw new Error('El archivo es demasiado grande para guardarlo (máximo 20 MB).');
    const mime = String(r.mime ?? a.mime ?? 'application/octet-stream');
    const path = `${a.conversacionId}/${a.mensajeId}.${extensionDe(mime)}`;
    const up = await db.storage.from(BUCKET_MEDIA).upload(path, datos, { contentType: mime.split(';')[0], upsert: true });
    if (up.error) throw new Error(up.error.message);
    const w = await db.rpc('wa_media_actualizar', { p_id: a.mensajeId, p_media: { path, bytes: datos.length, mime, estado: 'guardado', error: null } });
    if (w.error) throw new Error(w.error.message);
    return { ok: true, path };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    await db.rpc('wa_media_actualizar', { p_id: a.mensajeId, p_media: { estado: 'error', error: msg } });
    return { ok: false, error: msg };
  }
}
