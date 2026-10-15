/**
 * KODA "en vivo": el pulso que recalifica al instante, lo último que aprendió, lo que el
 * usuario hizo con sus prospectos y las recomendaciones del día (migración 0010).
 */
import { db } from '@/lib/supabase';
import type { ScoreLine } from '@/types/domain';

/** ¿Cuántos prospectos del usuario esperan recalificarse? */
export async function getPendientesMios(): Promise<number> {
  const { data, error } = await db.rpc('koda_pendientes_mios');
  if (error) throw error;
  return Number(data ?? 0);
}

export interface UltimoAprendizaje {
  nombre: string | null;
  aplicado: number;
  features: string[];
  hace_seg: number;
}

/** Lo último que KODA aprendió de este usuario (null si aún nada). */
export async function getUltimoAprendizaje(): Promise<UltimoAprendizaje | null> {
  const { data, error } = await db.rpc('koda_ultimo_aprendizaje');
  if (error) throw error;
  const r = (Array.isArray(data) ? data[0] : data) as UltimoAprendizaje | undefined;
  return r ? { ...r, aplicado: Number(r.aplicado), hace_seg: Number(r.hace_seg), features: r.features ?? [] } : null;
}

/**
 * Abrir un enlace del prospecto (web, WhatsApp, Instagram, Maps) es interés real: KODA lo
 * anota. Silencioso: nunca debe estorbar al usuario ni romper el clic.
 */
export function registrarContacto(prospectId: string): void {
  void Promise.resolve(db.rpc('koda_interaccion', { p_prospect: prospectId, p_tipo: 'contacto' })).catch(() => undefined);
}

export interface Reciente {
  id: string;
  nombre: string | null;
  aplicado: number;
  explicito: number | null;
  por_estado: number;
  por_actividad: number;
  updated_at: string;
}

/** Las últimas decisiones que KODA tiene en memoria. */
export async function getRecientes(uid: string, limit = 8): Promise<Reciente[]> {
  const { data, error } = await db
    .from('koda_veredictos')
    .select('id, nombre, aplicado, explicito, por_estado, por_actividad, updated_at')
    .eq('owner_id', uid)
    .neq('aplicado', 0)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Reciente[];
}

export interface ParaTi {
  id: string;
  nombre: string;
  categoria: string | null;
  ciudad: string | null;
  score: number;
  score_desglose: ScoreLine[];
}

/** Los prospectos que mejor encajan con el usuario y que aún no ha trabajado. */
export async function getParaTi(uid: string, limit = 5): Promise<ParaTi[]> {
  const { data, error } = await db
    .from('prospects')
    .select('id, nombre, categoria, ciudad, score, score_desglose')
    .eq('owner_id', uid)
    .in('status', ['nuevo', 'calificado'])
    .order('score', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as (Omit<ParaTi, 'score_desglose'> & { score_desglose: unknown })[])
    .filter((p) => (p.score ?? 0) > 0)
    .map((p) => ({ ...p, score_desglose: Array.isArray(p.score_desglose) ? (p.score_desglose as ScoreLine[]) : [] }));
}
