/**
 * Agente de respuestas de la Bandeja (migración 0017). Leer es una consulta normal (RLS: solo el propietario);
 * cambiar el modo, pausar un chat y descartar son RPC; redactar y probar pasan por la Edge Function `koda-connexo`.
 */
import { db } from '@/lib/supabase';
import { invokeConnexo } from '@/lib/data/connexo';

export type ModoAgente = 'apagado' | 'supervisado' | 'automatico';
export type EstadoBorrador = 'pendiente' | 'enviado' | 'editado' | 'descartado' | 'reemplazado' | 'automatico';

export interface ConfigAgente {
  id: number;
  modo: ModoAgente;
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
  uso?: { entrada?: number; salida?: number; cache_leido?: number };
  modelo?: string;
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

/** «Otra versión»: el agente vuelve a redactar la respuesta de ese chat (no envía nada). */
export async function generarBorradorAgente(convId: string): Promise<ResultadoGenerar> {
  return invokeConnexo<ResultadoGenerar>({ action: 'agente_generar', conversacion_id: convId });
}

/** Redacta una respuesta de prueba a un mensaje inventado (no guarda ni envía nada). */
export async function probarAgente(p: { mensaje: string; theme?: string; nombre?: string; historial?: { d: 'cliente' | 'nosotros'; t: string }[] }): Promise<ResultadoPrueba> {
  return invokeConnexo<ResultadoPrueba>({ action: 'agente_probar', ...p });
}
