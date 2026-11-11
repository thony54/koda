/**
 * Puente con Connexo Clients. Leer la lista es una consulta normal (RLS: solo quien puede
 * enviar, sobre lo suyo); enviar y refrescar estados pasa por la Edge Function `koda-connexo`,
 * que es la única que habla con el proyecto de Connexo.
 */
import { db, supabase } from '@/lib/supabase';
import { byOwner } from '@/lib/scope';

export async function invokeConnexo<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('koda-connexo', { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const b = await ctx.json(); if (b?.error) msg = b.error; } catch { /* cuerpo no-JSON */ }
    }
    throw new Error(msg);
  }
  return data as T;
}

export type ConnexoEstado =
  | 'pendiente' | 'borrador' | 'aprobado' | 'wa_enviado' | 'aceptado'
  | 'declinado' | 'vencido' | 'descartado' | 'sin_plantilla' | 'error';

type Variante = 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary';

export const ESTADO_CONNEXO: Record<ConnexoEstado, { label: string; variant: Variante; hint: string }> = {
  pendiente:     { label: 'Enviando',      variant: 'default', hint: 'Registrado; esperando la respuesta de Connexo.' },
  borrador:      { label: 'Borrador',      variant: 'info',    hint: 'Perfil armado, esperando tu aprobación.' },
  aprobado:      { label: 'Aprobado',      variant: 'primary', hint: 'Aprobado, listo para invitarlo por WhatsApp.' },
  wa_enviado:    { label: 'WhatsApp enviado', variant: 'warning', hint: 'Saludo enviado: espera su respuesta (la invitación vence a los 7 días).' },
  aceptado:      { label: 'Aceptó',        variant: 'success', hint: 'El negocio aceptó: su prueba de 7 días ya corre y recibió sus credenciales.' },
  declinado:     { label: 'Quizás después', variant: 'default', hint: 'Respondió que lo verá más adelante.' },
  vencido:       { label: 'Prueba vencida', variant: 'error',  hint: 'La prueba terminó y el perfil se desactivó.' },
  descartado:    { label: 'Descartado',    variant: 'default', hint: 'Lo descartaste.' },
  sin_plantilla: { label: 'Sin plantilla', variant: 'warning', hint: 'Su rubro aún no tiene plantilla en Connexo.' },
  error:         { label: 'Error',         variant: 'error',   hint: 'Falló el envío; se puede reintentar.' },
};

/**
 * Qué decir de un PROSPECTO según su espejo en Connexo (`prospects.connexo_estado`, migración 0015).
 * `disponible` = todavía se le puede ofrecer Connexo (nunca llegó a ver nada: error o sin plantilla).
 * 'duplicado' = otro prospecto con su mismo celular ya está en Connexo, así que a este tampoco se le escribe.
 */
export function estadoEnConnexo(
  estado: string | null | undefined,
): { label: string; variant: Variante; hint: string; disponible: boolean } | null {
  if (!estado) return null;
  if (estado === 'duplicado') {
    return { label: 'Mismo celular', variant: 'warning', hint: 'Otro negocio con este mismo celular ya está en Connexo: no se le escribe dos veces.', disponible: false };
  }
  const e = ESTADO_CONNEXO[estado as ConnexoEstado];
  if (!e) return null;
  return { ...e, disponible: estado === 'error' || estado === 'sin_plantilla' };
}

export interface ConnexoEnvio {
  id: string;
  owner_id: string;
  prospect_id: string | null;
  prospect_nombre: string;
  prospect_ciudad: string | null;
  categoria: string | null;
  rubro: string | null;
  job_id: string | null;
  busqueda_nombre: string | null;
  lote_id: string | null;
  estado: ConnexoEstado;
  detalle: string | null;
  connexo_username: string | null;
  connexo_theme: string | null;
  enviado_at: string;
  actualizado_at: string;
}

export async function listEnvios(): Promise<ConnexoEnvio[]> {
  const { data, error } = await byOwner(
    db.from('connexo_envios')
      .select('id, owner_id, prospect_id, prospect_nombre, prospect_ciudad, categoria, rubro, job_id, busqueda_nombre, lote_id, estado, detalle, connexo_username, connexo_theme, enviado_at, actualizado_at')
      .order('enviado_at', { ascending: false })
      .limit(1000),
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as ConnexoEnvio[];
}

// ── Lotes ───────────────────────────────────────────────────────────────────
// Cada vez que mandas prospectos a Connexo se arma un lote («Lote 7 · Gimnasios Quito»). El lote viaja con cada
// negocio, así lo controlas igual en KODA y en el Super Admin de Connexo.

export interface ConnexoLote {
  id: string;
  numero: number;
  nombre: string | null;
  created_at: string;
  /** Cuándo Connexo recibió el número y el nombre de este lote (null = falta; se manda al abrir la pantalla de Connexo). */
  sincronizado_at: string | null;
}

/** «Lote 7 · Gimnasios Quito» (o solo «Lote 7» si no tiene nombre). */
export const etiquetaLote = (l: Pick<ConnexoLote, 'numero' | 'nombre'>): string =>
  l.nombre ? `Lote ${l.numero} · ${l.nombre}` : `Lote ${l.numero}`;

export async function listLotes(): Promise<ConnexoLote[]> {
  const { data, error } = await db.from('connexo_lotes')
    .select('id, numero, nombre, created_at, sincronizado_at')
    .order('numero', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as ConnexoLote[];
}

/**
 * En qué lote está cada prospecto (`prospect_id → lote_id`), solo los que ya se mandaron a Connexo. Es lo que usa el mapa
 * para filtrar por lote. La API entrega 1000 filas por consulta, así que se pide por páginas.
 */
export async function listLoteDeProspectos(): Promise<Record<string, string>> {
  const PAGINA = 1000;
  const out: Record<string, string> = {};
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await byOwner(
      db.from('connexo_envios')
        .select('prospect_id, lote_id')
        .not('prospect_id', 'is', null)
        .not('lote_id', 'is', null)
        .order('id')
        .range(desde, desde + PAGINA - 1),
    );
    if (error) throw new Error(error.message);
    const filas = (data ?? []) as { prospect_id: string; lote_id: string }[];
    for (const f of filas) out[f.prospect_id] = f.lote_id;
    if (filas.length < PAGINA) return out;
  }
}

export async function renombrarLote(loteId: string, nombre: string): Promise<void> {
  await invokeConnexo({ action: 'lote_renombrar', lote_id: loteId, nombre });
}

/** Por qué un prospecto no sale en el lote (ver supabase/functions/_shared/connexoEnvio.ts). */
export type CodigoOmision =
  | 'ajeno' | 'opt_out' | 'anonimizado' | 'status' | 'ya_enviado' | 'sin_celular' | 'sin_rubro'
  | 'celular_repetido' | 'repetido_en_lote' | 'no_existe';

export const TITULO_OMISION: Record<CodigoOmision, string> = {
  ya_enviado: 'Ya están en Connexo',
  celular_repetido: 'Su celular ya está en Connexo',
  repetido_en_lote: 'Repetidos dentro del lote',
  sin_celular: 'Sin celular con WhatsApp',
  sin_rubro: 'Sin rubro reconocido',
  opt_out: 'Pidieron no ser contactados',
  status: 'Marcados como descartado / no contactar',
  anonimizado: 'Datos anonimizados',
  ajeno: 'No son tuyos',
  no_existe: 'Ya no existen',
};

export interface ResultadoEnvio {
  prospect_id: string;
  nombre?: string;
  resultado: 'enviado' | 'omitido' | 'error' | 'listo';
  motivo?: string;
  codigo?: CodigoOmision;
  estado?: ConnexoEstado;
  username?: string | null;
  theme?: string | null;
  /** Solo en la vista previa: rubro de KODA que decide la plantilla. */
  rubro?: string | null;
  categoria?: string | null;
  ciudad?: string | null;
}

/**
 * La función de KODA llama a Connexo una vez por negocio dentro de la misma ejecución y Supabase corta pasadas ~30
 * llamadas encadenadas («Rate limit exceeded for trace»), así que se manda en tandas de 25 una tras otra.
 */
const TANDA_PUENTE = 25;
const enTandas = <T,>(xs: T[], n = TANDA_PUENTE): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/** Vista previa de un lote: qué saldría y por qué se omite el resto. No envía nada ni toca la base. */
export async function vistaPreviaEnvio(prospectIds: string[]): Promise<ResultadoEnvio[]> {
  const resultados: ResultadoEnvio[] = [];
  // Se pide por tandas de 200 (tope de la función); dentro de cada una ya se detectan los celulares repetidos.
  for (const tanda of enTandas(prospectIds, 200)) {
    const r = await invokeConnexo<{ resultados: ResultadoEnvio[] }>({ action: 'enviar', dry_run: true, prospect_ids: tanda });
    resultados.push(...r.resultados);
  }
  return resultados;
}

export interface LoteCreado { id: string; numero: number; nombre: string | null }

/**
 * Envía los prospectos a Connexo dentro de UN lote: el primero que se pueda enviar lo abre y las tandas siguientes
 * lo siguen llenando. `onProgreso` avisa cuántos ya se procesaron.
 */
export async function enviarAConnexo(
  prospectIds: string[],
  nombreLote?: string,
  onProgreso?: (hechos: number, total: number) => void,
): Promise<{ enviados: number; resultados: ResultadoEnvio[]; lote: LoteCreado | null }> {
  let enviados = 0;
  let lote: LoteCreado | null = null;
  const resultados: ResultadoEnvio[] = [];
  for (const tanda of enTandas(prospectIds)) {
    const r: { enviados: number; resultados: ResultadoEnvio[]; lote: LoteCreado | null } = await invokeConnexo({
      action: 'enviar',
      prospect_ids: tanda,
      lote: lote ? { id: lote.id } : { nombre: nombreLote },
    });
    lote = r.lote ?? lote;
    enviados += r.enviados;
    resultados.push(...r.resultados);
    onProgreso?.(resultados.length, prospectIds.length);
  }
  return { enviados, resultados, lote };
}

/** Pregunta a Connexo cómo van los envíos y actualiza el espejo local. */
export async function refrescarEstadosConnexo(): Promise<{ configurado: boolean; actualizados: number }> {
  return invokeConnexo({ action: 'estado' });
}

// ── WhatsApp (lo envía Connexo; aquí solo se pide y se ve el cupo del día) ──

export interface CupoWhatsApp {
  configurado: boolean;
  limite: number | null;
  usados: number | null;
  disponibles: number | null;
}

/** Cuántos WhatsApp quedan hoy (ventana continua de 24 h). */
export async function cupoWhatsApp(): Promise<CupoWhatsApp> {
  return invokeConnexo({ action: 'whatsapp_cupo' });
}

export interface ResultadoWhatsApp {
  id: string;
  nombre?: string;
  resultado: 'enviado' | 'omitido' | 'error';
  motivo?: string;
}

/** Manda el saludo inicial a los negocios APROBADOS que quepan hoy; el resto queda aprobado para después. */
export async function enviarWhatsApp(
  ids: string[],
): Promise<{ enviados: number; resultados: ResultadoWhatsApp[]; cupo: Omit<CupoWhatsApp, 'configurado'> | null }> {
  return invokeConnexo({ action: 'whatsapp_enviar', envio_ids: ids });
}

// ── Revisión de los borradores ──────────────────────────────────────────────

export type PasoRevision = 'aprobar' | 'devolver' | 'descartar' | 'restaurar' | 'rellenar';

export interface ResultadoRevision {
  id: string;
  nombre?: string;
  ok: boolean;
  estado?: ConnexoEstado;
  error?: string;
}

/** Aprueba, devuelve, descarta o restaura uno o varios negocios. Connexo valida cada paso. */
export async function revisarEnvios(ids: string[], paso: PasoRevision): Promise<{ resultados: ResultadoRevision[] }> {
  const resultados: ResultadoRevision[] = [];
  for (const tanda of enTandas(ids)) {
    const r = await invokeConnexo<{ resultados: ResultadoRevision[] }>({ action: 'revision', envio_ids: tanda, paso });
    resultados.push(...r.resultados);
  }
  return { resultados };
}

export type OrigenDato = 'koda' | 'banco' | 'mixto';

export interface RellenoConnexo {
  paquete: string | null;
  campos: Record<string, OrigenDato>;
  enlaces: number;
  tablas: Record<string, number>;
}

export interface DetalleEnvio {
  estado: ConnexoEstado;
  detalle: string | null;
  username: string | null;
  theme: string | null;
  clave: string | null;
  relleno: RellenoConnexo | null;
  preview_url: string | null;
}

export async function detalleEnvio(envioId: string): Promise<DetalleEnvio> {
  return invokeConnexo({ action: 'detalle', envio_id: envioId });
}

/** Pasos de revisión que KODA ofrece por estado (el WhatsApp y la aceptación los maneja Connexo). */
export const PASOS_POR_ESTADO: Partial<Record<ConnexoEstado, { paso: PasoRevision; label: string; tono: 'primary' | 'secondary' | 'danger' }[]>> = {
  borrador: [
    { paso: 'aprobar', label: 'Aprobar', tono: 'primary' },
    { paso: 'descartar', label: 'Descartar', tono: 'danger' },
  ],
  aprobado: [
    { paso: 'devolver', label: 'Volver a revisión', tono: 'secondary' },
    { paso: 'descartar', label: 'Descartar', tono: 'danger' },
  ],
  descartado: [{ paso: 'restaurar', label: 'Restaurar', tono: 'primary' }],
};

/** Estados desde los que se puede aprobar / descartar / mandar por WhatsApp en bloque. */
export const ESTADOS_PARA: Record<'aprobar' | 'descartar' | 'whatsapp', ConnexoEstado[]> = {
  aprobar: ['borrador'],
  descartar: ['borrador', 'aprobado'],
  whatsapp: ['aprobado'],
};

/** El envío por WhatsApp falló y dejó su motivo en `detalle` (el negocio sigue aprobado). */
export const falloWhatsApp = (e: Pick<ConnexoEnvio, 'estado' | 'detalle'>): boolean =>
  e.estado === 'aprobado' && !!e.detalle && e.detalle.startsWith('WhatsApp no salió');

export const PLANTILLA_CONNEXO: Record<string, string> = {
  default: 'Estándar', barber: 'Barbería', gastro: 'Gastronomía', petcare: 'Mascotas', medical: 'Salud',
  ecom: 'Ecommerce', stage: 'Artista', realty: 'Inmobiliaria', sublima: 'Sublimados', gym: 'Gimnasio', hotel: 'Hotel', books: 'Librería', photo: 'Fotografía',
};

// Campos del perfil de Connexo → cómo se le muestra a quien revisa. Lo que no está aquí no se lista.
const CAMPO_LABEL: Record<string, string> = {
  displayName: 'Nombre', company: 'Nombre', location: 'Dirección', phone: 'Teléfono', whatsapp: 'WhatsApp',
  contactEmail: 'Correo', socialMedia: 'Redes y web', bio: 'Descripción', aboutMe: 'Sobre nosotros', jobTitle: 'Título',
  socialProof: 'Calificación de Google', logoURL: 'Logo con iniciales', products: 'Catálogo y servicios',
  barber_products: 'Productos a la venta', clinicServices: 'Servicios', coverImageURL: 'Portada',
  galleryImageURLs: 'Galería de fotos', businessHours: 'Horario', faqs: 'Preguntas frecuentes',
  backgroundColor: 'Colores y estilo', buttonColor: 'Colores y estilo', textColor: 'Colores y estilo',
  reservationsEnabled: 'Reservas', reservationSettings: 'Reservas', tableCount: 'Reservas',
  ecom_booking_form: 'Formulario de citas', gym_settings: 'Reservas', hotel_settings: 'Reservas',
};

const TABLA_LABEL: Record<string, [string, string]> = {
  gym_plans: ['plan', 'planes'], gym_classes: ['clase', 'clases'], gym_coaches: ['entrenador', 'entrenadores'],
  hotel_rooms: ['habitación', 'habitaciones'], hotel_services: ['servicio del hotel', 'servicios del hotel'],
  realty_properties: ['propiedad', 'propiedades'], realty_agents: ['asesor', 'asesores'],
  barber_staff: ['persona del equipo', 'personas del equipo'], ecom_staff: ['persona del equipo', 'personas del equipo'],
  sublima_products: ['producto de ejemplo', 'productos de ejemplo'],
  books_titles: ['libro de ejemplo', 'libros de ejemplo'],
  stage_classes: ['clase de ejemplo', 'clases de ejemplo'],
};

/** Separa lo que viene del prospecto (KODA) de lo que es contenido de EJEMPLO del banco de recursos. */
export function resumirRelleno(r: RellenoConnexo | null): { deKoda: string[]; deEjemplo: string[]; tablas: string[]; enlaces: number } {
  const deKoda = new Set<string>();
  const deEjemplo = new Set<string>();
  for (const [campo, origen] of Object.entries(r?.campos ?? {})) {
    const label = CAMPO_LABEL[campo];
    if (!label) continue;
    if (origen === 'koda' || origen === 'mixto') deKoda.add(label);
    if (origen === 'banco' || origen === 'mixto') deEjemplo.add(label);
  }
  // Si un dato viene del prospecto, no se anuncia también como ejemplo (p. ej. un teléfono real).
  for (const l of deKoda) if (l !== 'Descripción') deEjemplo.delete(l);
  const tablas = Object.entries(r?.tablas ?? {}).filter(([, n]) => n > 0).map(([t, n]) => {
    const [uno, varios] = TABLA_LABEL[t] ?? [t, t];
    return `${n} ${n === 1 ? uno : varios}`;
  });
  return { deKoda: [...deKoda], deEjemplo: [...deEjemplo], tablas, enlaces: r?.enlaces ?? 0 };
}

// ── Lo que KODA aprende de las respuestas ───────────────────────────────────

/** Estados de quien ya recibió la invitación por WhatsApp (ya hay una respuesta, o se espera). */
export const ESTADOS_INVITADOS: ConnexoEstado[] = ['wa_enviado', 'aceptado', 'declinado', 'vencido'];

export interface FilaRespuesta {
  clave: string;
  invitados: number;
  aceptaron: number;
  declinaron: number;
  /** Aún sin respuesta o con la invitación/prueba vencida. */
  otros: number;
}

/**
 * Cuántos de los invitados aceptaron, agrupados por rubro o ciudad. Es lo mismo que KODA va
 * aprendiendo en su memoria (migración 0014), pero a la vista: qué tipo de negocio responde.
 */
export function respuestasPor(
  envios: Pick<ConnexoEnvio, 'estado' | 'rubro' | 'categoria' | 'prospect_ciudad'>[],
  campo: 'rubro' | 'ciudad',
): FilaRespuesta[] {
  const filas = new Map<string, FilaRespuesta>();
  for (const e of envios) {
    if (!ESTADOS_INVITADOS.includes(e.estado)) continue;
    const clave = ((campo === 'rubro' ? e.rubro ?? e.categoria : e.prospect_ciudad) ?? '').trim();
    if (!clave) continue;
    const f = filas.get(clave) ?? { clave, invitados: 0, aceptaron: 0, declinaron: 0, otros: 0 };
    f.invitados += 1;
    if (e.estado === 'aceptado') f.aceptaron += 1;
    else if (e.estado === 'declinado') f.declinaron += 1;
    else f.otros += 1;
    filas.set(clave, f);
  }
  return [...filas.values()].sort((a, b) =>
    b.aceptaron / b.invitados - a.aceptaron / a.invitados || b.invitados - a.invitados || a.clave.localeCompare(b.clave));
}
