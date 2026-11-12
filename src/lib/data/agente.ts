/**
 * Agente de respuestas de la Bandeja (migración 0017). Leer es una consulta normal (RLS: solo el propietario);
 * cambiar el modo, pausar un chat y descartar son RPC; redactar y probar pasan por la Edge Function `koda-connexo`.
 */
import { db } from '@/lib/supabase';
import { invokeConnexo } from '@/lib/data/connexo';

export type ModoAgente = 'apagado' | 'supervisado' | 'automatico';
/** Quién redacta (0018): el banco de respuestas (gratis), Claude (clave y costo) o el banco primero y Claude solo si no reconoce la pregunta. */
export type MotorAgente = 'recuerdo' | 'claude' | 'mixto';
export type EstadoBorrador = 'pendiente' | 'enviado' | 'editado' | 'descartado' | 'reemplazado' | 'automatico';

export interface ConfigAgente {
  id: number;
  modo: ModoAgente;
  /** Sin la migración 0018 no viene: el agente sigue funcionando con Claude, como antes. */
  motor?: MotorAgente;
  modelo: string;
  esfuerzo: 'low' | 'medium' | 'high';
  espera_seg: number;
  updated_at: string;
}

export interface BorradorAgente {
  id: string;
  conversacion_id: string;
  mensaje_id: string | null;
  accion: 'responder' | 'traspasar';
  texto: string | null;
  intencion: string | null;
  confianza: 'alta' | 'media' | 'baja' | null;
  nota: string | null;
  estado: EstadoBorrador;
  created_at: string;
}

export interface ResumenAgente {
  aprobados: number;
  editados: number;
  descartados: number;
  pendientes: number;
  aprendidos: number;
  automaticos: number;
  /** % de las últimas 30 decisiones en que el propietario envió el borrador tal cual; null si aún no hay. */
  acierto: number | null;
  /** Banco de respuestas (0018): activas, aprendidas de lo que el propietario envía, y las que ya pueden ir solas. */
  banco?: number;
  banco_aprendidas?: number;
  banco_confiables?: number;
}

export type AccionBanco = 'responder' | 'traspasar' | 'omitir';
export type OrigenBanco = 'fabrica' | 'aprendida' | 'manual';
export interface VarianteBanco { t: string; o: OrigenBanco }
/** Una respuesta del banco: cómo la preguntan, cómo se contesta y su historial de aciertos. */
export interface EntradaBanco {
  id: string;
  clave: string | null;
  titulo: string;
  intencion: string;
  accion: AccionBanco;
  disparadores: string[];
  excluye: string[];
  respuestas: VarianteBanco[];
  /** Etapas de la demo en que aplica; null = todas. */
  estados: string[] | null;
  cierre: boolean;
  nota: string | null;
  origen: OrigenBanco;
  verificada: boolean;
  activo: boolean;
  editada: boolean;
  usos: number;
  aprobados: number;
  editados: number;
  descartes: number;
  ultimo_uso: string | null;
  updated_at: string;
}

/**
 * ¿Puede ir en modo automático? Verificada por el propietario, o aprobada 3 veces sin cambios y con menos de la mitad de correcciones.
 * (La misma regla que aplica el servidor: lo delicado, o sea «traspasar» y «omitir», nunca va solo.)
 */
export const puedeIrSola = (e: Pick<EntradaBanco, 'accion' | 'activo' | 'verificada' | 'aprobados' | 'editados' | 'descartes'>): boolean =>
  e.accion === 'responder' && e.activo && (e.verificada || (e.aprobados >= 3 && e.aprobados >= 2 * (e.editados + e.descartes)));

/** Lo que se manda al guardar una respuesta del banco (lo valida también el servidor). */
export interface GuardarEntrada {
  id?: string | null;
  titulo: string;
  intencion?: string;
  accion: AccionBanco;
  disparadores: string[];
  respuestas: string[];
  estados?: string[] | null;
  cierre: boolean;
  nota?: string | null;
  verificada?: boolean;
  activo?: boolean;
}

export interface ResultadoGenerar {
  ok?: boolean;
  estado?: 'borrador' | 'traspaso' | 'enviado_auto' | 'omitido' | 'obsoleto' | 'error';
  motivo?: string;
  error?: string;
  sin_clave?: boolean;
}

export interface ResultadoPrueba {
  ok?: boolean;
  accion?: 'responder' | 'traspasar' | 'omitir';
  texto?: string;
  nota?: string;
  intencion?: string;
  confianza?: 'alta' | 'media' | 'baja';
  uso?: { entrada?: number; salida?: number; cache_leido?: number; puntaje?: number };
  modelo?: string;
  /** Quién la redactó: el banco de respuestas o Claude. */
  motor?: 'recuerdo' | 'claude';
  error?: string;
  sin_clave?: boolean;
}

export async function getConfigAgente(): Promise<ConfigAgente | null> {
  const { data, error } = await db.from('wa_agente_config').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ConfigAgente | null) ?? null;
}

export async function setModoAgente(modo: ModoAgente): Promise<void> {
  const { error } = await db.rpc('wa_agente_modo', { p_modo: modo });
  if (error) throw new Error(error.message);
}

export async function listBorradoresPendientes(): Promise<BorradorAgente[]> {
  const { data, error } = await db.from('wa_agente_borradores').select('*').eq('estado', 'pendiente').order('created_at', { ascending: false }).limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []) as BorradorAgente[];
}

export async function descartarBorradorAgente(id: string): Promise<void> {
  const { error } = await db.rpc('wa_agente_descartar', { p_borrador: id });
  if (error) throw new Error(error.message);
}

export async function pausarAgenteEnChat(convId: string, valor: boolean): Promise<void> {
  const { error } = await db.rpc('wa_agente_pausar', { p_conv: convId, p_valor: valor });
  if (error) throw new Error(error.message);
}

export async function resumenAgente(): Promise<ResumenAgente> {
  const { data, error } = await db.rpc('wa_agente_resumen');
  if (error) throw new Error(error.message);
  return data as ResumenAgente;
}

export async function estadoClaveAgente(): Promise<{ clave: boolean }> {
  const r = await invokeConnexo<{ clave?: boolean }>({ action: 'agente_estado' });
  return { clave: r.clave === true };
}

export async function setMotorAgente(motor: MotorAgente): Promise<void> {
  const { error } = await db.rpc('wa_agente_motor', { p_motor: motor });
  if (error) throw new Error(error.message);
}

// ── Banco de respuestas (0018) ──────────────────────────────────────────────

export async function listBanco(): Promise<EntradaBanco[]> {
  const { data, error } = await db.from('wa_agente_banco').select('*').order('created_at', { ascending: true }).limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as EntradaBanco[];
}

/** Crea o edita una respuesta del banco. Devuelve su id. */
export async function guardarEntradaBanco(p: GuardarEntrada): Promise<string> {
  const { data, error } = await db.rpc('wa_banco_guardar', { p });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Activar/desactivar o verificar una respuesta sin tocar su texto. */
export async function marcarEntradaBanco(id: string, cambios: { activo?: boolean; verificada?: boolean }): Promise<void> {
  const { error } = await db.rpc('wa_banco_marcar', { p_id: id, p_activo: cambios.activo ?? null, p_verificada: cambios.verificada ?? null });
  if (error) throw new Error(error.message);
}

/** Las aprendidas y las tuyas se borran; las de fábrica solo se desactivan (se pueden volver a activar). */
export async function borrarEntradaBanco(id: string): Promise<'borrada' | 'desactivada' | 'no_existe'> {
  const { data, error } = await db.rpc('wa_banco_borrar', { p_id: id });
  if (error) throw new Error(error.message);
  return data as 'borrada' | 'desactivada' | 'no_existe';
}

/** Sube las respuestas de fábrica al banco (idempotente: no pisa lo que editaste ni lo aprendido). */
export async function sembrarBanco(): Promise<{ semillas?: number; total?: number }> {
  return invokeConnexo<{ semillas?: number; total?: number }>({ action: 'agente_banco_sembrar' });
}

/** «Otra versión»: el agente vuelve a redactar la respuesta de ese chat (no envía nada). */
export async function generarBorradorAgente(convId: string): Promise<ResultadoGenerar> {
  return invokeConnexo<ResultadoGenerar>({ action: 'agente_generar', conversacion_id: convId });
}

/** Redacta una respuesta de prueba a un mensaje inventado (no guarda ni envía nada). */
export async function probarAgente(p: { mensaje: string; theme?: string; nombre?: string; estado?: string; motor?: MotorAgente; historial?: { d: 'cliente' | 'nosotros'; t: string }[] }): Promise<ResultadoPrueba> {
  return invokeConnexo<ResultadoPrueba>({ action: 'agente_probar', ...p });
}
