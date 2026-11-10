/**
 * Archivos que se envían por WhatsApp desde la bandeja: validación, conversión y notas de voz.
 *
 * WhatsApp (Cloud API) solo acepta:  fotos JPG/PNG (≤ 5 MB) · audios AAC/M4A/MP3/AMR/OGG-Opus (≤ 16 MB) · video MP4/3GP (≤ 16 MB)
 * · documentos PDF/Office/TXT. Un .webp, .gif o captura rara NO vale como foto, y el navegador graba en WebM: por eso se
 * convierte aquí (fotos → JPG; notas de voz → MP3) antes de subir, para que lo que sale siempre sea válido.
 */
export type TipoArchivo = 'image' | 'audio' | 'video' | 'document';

export interface ArchivoListo {
  blob: Blob;
  mime: string;
  nombre: string;
  tipo: TipoArchivo;
  bytes: number;
  /** Grabado con el micrófono (se muestra como «Mensaje de voz»). */
  voz?: boolean;
}

export const MB = 1024 * 1024;
export const LIMITE_BYTES: Record<TipoArchivo, number> = { image: 5 * MB, audio: 16 * MB, video: 16 * MB, document: 16 * MB };
export const MAX_GRABACION_SEG = 300;

const DOC_MIME = /^(application\/(pdf|msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))|text\/plain)$/;
const DOC_POR_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint', txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const AUDIO_OK = /^audio\/(aac|mp4|mpeg|amr|ogg)$/;
const EXT_POR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/amr': 'amr',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'application/pdf': 'pdf', 'text/plain': 'txt', 'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls', 'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

export const mimeBase = (m: string | null | undefined): string => String(m ?? '').split(';')[0].trim().toLowerCase();
export const extensionDe = (mime: string): string => EXT_POR_MIME[mimeBase(mime)] ?? 'bin';
export const mbDe = (bytes: number): string => `${(bytes / MB).toFixed(bytes < MB ? 2 : 1)} MB`;

/** Nombre apto para el chat (sin rutas ni caracteres raros). */
export function nombreLimpio(nombre: string, mime: string): string {
  const ext = extensionDe(mime);
  const base = nombre.replace(/\.[^.]*$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 _-]+/g, ' ').trim().replace(/\s+/g, '-').slice(0, 60);
  return `${base || 'archivo'}.${ext}`;
}

// ── Fotos ───────────────────────────────────────────────────────────────────

const aBlob = (canvas: HTMLCanvasElement, tipo: string, calidad: number): Promise<Blob> =>
  new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('No pude convertir la imagen.'))), tipo, calidad));

/** JPG/PNG de hasta ~4,5 MB pasan tal cual; lo demás (webp, gif, fotos enormes) se redibuja y comprime a JPG. */
export async function prepararImagen(file: Blob, nombre: string): Promise<ArchivoListo> {
  const mime = mimeBase(file.type);
  if ((mime === 'image/jpeg' || mime === 'image/png') && file.size <= 4.5 * MB) {
    return { blob: file, mime, nombre: nombreLimpio(nombre, mime), tipo: 'image', bytes: file.size };
  }
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('No pude leer esa imagen. Usa una foto JPG o PNG.'); }
  try {
    for (const [lado, calidad] of [[2048, 0.86], [1600, 0.78], [1280, 0.7]] as const) {
      const k = Math.min(1, lado / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bmp.width * k));
      canvas.height = Math.max(1, Math.round(bmp.height * k));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No pude procesar la imagen.');
      ctx.fillStyle = '#ffffff';                           // los PNG con transparencia no se ven negros en el JPG
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await aBlob(canvas, 'image/jpeg', calidad);
      if (blob.size <= LIMITE_BYTES.image) return { blob, mime: 'image/jpeg', nombre: nombreLimpio(nombre, 'image/jpeg'), tipo: 'image', bytes: blob.size };
    }
  } finally {
    bmp.close();
  }
  throw new Error('La imagen es demasiado pesada incluso comprimida (máximo 5 MB).');
}

// ── Audio ───────────────────────────────────────────────────────────────────

/** Convierte cualquier audio que el navegador sepa leer (WebM/Opus, WAV, OGG…) a MP3 mono: lo que WhatsApp sí reproduce. */
export async function aMp3(blob: Blob): Promise<Blob> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error('Este navegador no puede convertir audio.');
  const ctx = new Ctx();
  let buf: AudioBuffer;
  try { buf = await ctx.decodeAudioData(await blob.arrayBuffer()); } catch { throw new Error('No pude leer ese audio.'); } finally { void ctx.close(); }

  // Mezcla a mono y pasa a enteros de 16 bits.
  const n = buf.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels;
  }
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = Math.max(-1, Math.min(1, mono[i])) * 0x7fff;

  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const enc = new Mp3Encoder(1, buf.sampleRate, 64);
  const partes: Uint8Array[] = [];
  for (let i = 0; i < n; i += 1152) {
    const trozo = enc.encodeBuffer(pcm.subarray(i, i + 1152));
    if (trozo.length) partes.push(new Uint8Array(trozo));
  }
  const fin = enc.flush();
  if (fin.length) partes.push(new Uint8Array(fin));
  return new Blob(partes as BlobPart[], { type: 'audio/mpeg' });
}

export async function prepararAudio(file: Blob, nombre: string, voz = false): Promise<ArchivoListo> {
  const mime = mimeBase(file.type);
  if (AUDIO_OK.test(mime)) {
    if (file.size > LIMITE_BYTES.audio) throw new Error(`El audio pesa ${mbDe(file.size)} (máximo 16 MB).`);
    return { blob: file, mime, nombre: nombreLimpio(nombre, mime), tipo: 'audio', bytes: file.size, voz };
  }
  const mp3 = await aMp3(file);
  if (mp3.size > LIMITE_BYTES.audio) throw new Error('El audio es demasiado largo (máximo 16 MB).');
  return { blob: mp3, mime: 'audio/mpeg', nombre: nombreLimpio(nombre, 'audio/mpeg'), tipo: 'audio', bytes: mp3.size, voz };
}

// ── Cualquier archivo (adjuntar, pegar, arrastrar) ──────────────────────────

/** Valida y deja listo un archivo elegido por el usuario. Lanza un Error con el motivo en español si WhatsApp no lo admite. */
export async function prepararArchivo(file: File): Promise<ArchivoListo> {
  const mime = mimeBase(file.type);
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (file.size === 0) throw new Error('Ese archivo está vacío.');

  if (mime.startsWith('image/')) return prepararImagen(file, file.name || 'foto');
  if (mime.startsWith('audio/')) return prepararAudio(file, file.name || 'audio');
  if (mime === 'video/mp4' || mime === 'video/3gpp') {
    if (file.size > LIMITE_BYTES.video) throw new Error(`El video pesa ${mbDe(file.size)} (máximo 16 MB).`);
    return { blob: file, mime, nombre: nombreLimpio(file.name || 'video', mime), tipo: 'video', bytes: file.size };
  }
  if (mime.startsWith('video/')) throw new Error('WhatsApp solo admite video MP4. Conviértelo y vuelve a intentarlo.');
  const docMime = DOC_MIME.test(mime) ? mime : DOC_POR_EXTENSION[ext];
  if (docMime) {
    if (file.size > LIMITE_BYTES.document) throw new Error(`El documento pesa ${mbDe(file.size)} (máximo 16 MB).`);
    // El navegador a veces no informa el tipo de un .docx: se usa el de la extensión para que Meta lo acepte.
    const blob = mime === docMime ? file : new Blob([file], { type: docMime });
    return { blob, mime: docMime, nombre: nombreLimpio(file.name || 'documento', docMime), tipo: 'document', bytes: file.size };
  }
  throw new Error('WhatsApp no admite ese tipo de archivo. Puedes enviar fotos, audios, video MP4, PDF y documentos de Office.');
}

// ── Nota de voz con el micrófono ────────────────────────────────────────────

export interface Grabacion {
  /** Termina y devuelve la nota de voz lista para enviar (MP3). */
  parar: () => Promise<ArchivoListo>;
  /** Descarta lo grabado y suelta el micrófono. */
  cancelar: () => void;
  inicio: number;
}

export async function iniciarGrabacion(): Promise<Grabacion> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('Este navegador no permite grabar audio.');
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    throw new Error('No pude usar el micrófono. Permítelo en el candado de la barra de direcciones y vuelve a intentarlo.');
  }
  const preferidos = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
  const mimeGrab = preferidos.find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, mimeGrab ? { mimeType: mimeGrab } : undefined);
  const trozos: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) trozos.push(e.data); };
  const soltar = () => stream.getTracks().forEach((t) => t.stop());
  const fin = new Promise<Blob>((res) => { rec.onstop = () => res(new Blob(trozos, { type: rec.mimeType || mimeGrab || 'audio/webm' })); });
  rec.start(250);
  const inicio = Date.now();

  return {
    inicio,
    cancelar: () => { rec.onstop = null; if (rec.state !== 'inactive') rec.stop(); soltar(); },
    parar: async () => {
      if (rec.state !== 'inactive') rec.stop();
      const blob = await fin;
      soltar();
      if (Date.now() - inicio < 600 || blob.size < 500) throw new Error('La nota de voz quedó vacía. Mantén pulsado un poco más.');
      const f = new Date();
      const nombre = `nota-de-voz-${f.getFullYear()}${String(f.getMonth() + 1).padStart(2, '0')}${String(f.getDate()).padStart(2, '0')}-${String(f.getHours()).padStart(2, '0')}${String(f.getMinutes()).padStart(2, '0')}.mp3`;
      return prepararAudio(blob, nombre, true);
    },
  };
}
