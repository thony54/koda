/**
 * Puente con Connexo Clients. Leer la lista es una consulta normal (RLS: solo quien puede
 * enviar, sobre lo suyo); enviar y refrescar estados pasa por la Edge Function `koda-connexo`,
 * que es la única que habla con el proyecto de Connexo.
 */
import { db, supabase } from '@/lib/supabase';
import { byOwner } from '@/lib/scope';

async function invokeConnexo<T>(body: Record<string, unknown>): Promise<T> {
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
      .select('id, owner_id, prospect_id, prospect_nombre, prospect_ciudad, categoria, rubro, job_id, busqueda_nombre, estado, detalle, connexo_username, connexo_theme, enviado_at, actualizado_at')
      .order('enviado_at', { ascending: false })
      .limit(500),
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as ConnexoEnvio[];
}

export interface ResultadoEnvio {
  prospect_id: string;
  nombre?: string;
  resultado: 'enviado' | 'omitido' | 'error';
  motivo?: string;
  estado?: ConnexoEstado;
  username?: string | null;
  theme?: string | null;
}

/**
 * La función de KODA llama a Connexo una vez por negocio dentro de la misma ejecución y Supabase corta pasadas ~30
 * llamadas encadenadas («Rate limit exceeded for trace»), así que se manda en tandas de 25 una tras otra.
 */
const TANDA_PUENTE = 25;
const enTandas = <T,>(xs: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += TANDA_PUENTE) out.push(xs.slice(i, i + TANDA_PUENTE));
  return out;
};

export async function enviarAConnexo(prospectIds: string[]): Promise<{ enviados: number; resultados: ResultadoEnvio[] }> {
  let enviados = 0;
  const resultados: ResultadoEnvio[] = [];
  for (const tanda of enTandas(prospectIds)) {
    const r = await invokeConnexo<{ enviados: number; resultados: ResultadoEnvio[] }>({ action: 'enviar', prospect_ids: tanda });
    enviados += r.enviados;
    resultados.push(...r.resultados);
  }
  return { enviados, resultados };
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
  ecom: 'Ecommerce', stage: 'Artista', realty: 'Inmobiliaria', sublima: 'Sublimados', gym: 'Gimnasio', hotel: 'Hotel', books: 'Librería',
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
