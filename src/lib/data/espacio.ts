/**
 * "Mi espacio": lo que el usuario le enseña a KODA sobre su nicho y lo que KODA
 * recuerda de sus decisiones (tablas koda_perfil / koda_memoria / koda_veredictos,
 * migración 0009). Todo es PROPIO del usuario: RLS lo garantiza.
 */
import { db, supabase } from '@/lib/supabase';
import type { KodaMemoria, KodaPerfil } from '@/types/database';

/** Lo que el usuario edita (el resto —versión, fechas— lo maneja la base). */
export type EspacioInput = Pick<
  KodaPerfil,
  'negocio' | 'cliente_ideal' | 'rubros' | 'ciudades' | 'palabras_clave' | 'palabras_excluidas' | 'pesos' | 'aprende'
>;

export const ESPACIO_VACIO: EspacioInput = {
  negocio: '',
  cliente_ideal: '',
  rubros: [],
  ciudades: [],
  palabras_clave: [],
  palabras_excluidas: [],
  pesos: {},
  aprende: true,
};

export async function getMiEspacio(uid: string): Promise<KodaPerfil | null> {
  // La cuenta propietaria puede LEER todos los espacios: se filtra por el propio.
  const { data, error } = await db.from('koda_perfil').select('*').eq('owner_id', uid).maybeSingle();
  if (error) throw error;
  return (data as KodaPerfil | null) ?? null;
}

export async function saveMiEspacio(uid: string, input: EspacioInput): Promise<KodaPerfil> {
  const { data, error } = await db
    .from('koda_perfil')
    .upsert({ owner_id: uid, ...input }, { onConflict: 'owner_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data as KodaPerfil;
}

export async function getMiMemoria(uid: string): Promise<KodaMemoria[]> {
  const out: KodaMemoria[] = [];
  for (let desde = 0; desde < 5000; desde += 1000) {
    const { data, error } = await db
      .from('koda_memoria').select('feature, pos, neg').eq('owner_id', uid)
      .order('feature').range(desde, desde + 999);
    if (error) throw error;
    const rows = (data ?? []) as KodaMemoria[];
    out.push(...rows.map((r) => ({ feature: r.feature, pos: Number(r.pos), neg: Number(r.neg) })));
    if (rows.length < 1000) break;
  }
  return out;
}

export interface ResumenAprendizaje {
  decisiones: number;
  positivas: number;
  negativas: number;
}

export async function getMiResumen(uid: string): Promise<ResumenAprendizaje> {
  const { data, error } = await db.rpc('koda_resumen', { p_owner: uid });
  if (error) throw error;
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  return {
    decisiones: Number(r?.decisiones ?? 0),
    positivas: Number(r?.positivas ?? 0),
    negativas: Number(r?.negativas ?? 0),
  };
}

/** Lo que el usuario ya le dijo a KODA sobre UN prospecto: 3 = 👍, -3 = 👎, null = nada explícito. */
export async function getVeredicto(prospectId: string): Promise<{ explicito: number | null; por_estado: number } | null> {
  const { data, error } = await db
    .from('koda_veredictos').select('explicito, por_estado').eq('prospect_id', prospectId).maybeSingle();
  if (error) throw error;
  return (data as { explicito: number | null; por_estado: number } | null) ?? null;
}

/** 👍 (3) / 👎 (-3) / quitar (0) sobre un prospecto propio. KODA lo recuerda para siempre. */
export async function marcarProspecto(prospectId: string, valor: 3 | -3 | 0): Promise<void> {
  const { error } = await db.rpc('koda_marcar_prospecto', { p_prospect: prospectId, p_valor: valor });
  if (error) throw new Error(error.message);
}

/** Borra todo lo que KODA aprendió (el espacio —rubros, ciudades, pesos— se conserva). */
export async function olvidarTodo(): Promise<void> {
  const { error } = await db.rpc('koda_olvidar');
  if (error) throw new Error(error.message);
}

/**
 * Pide a KODA que vuelva a calificar los prospectos del usuario con su espacio y lo
 * aprendido. Devuelve cuántos calificó y si quedó trabajo (el cron lo termina solo).
 */
export async function recalcularPuntajes(): Promise<{ calificados: number; pendientes: boolean }> {
  const { data, error } = await supabase.functions.invoke('koda-scorer', { body: {} });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const b = await ctx.json(); if (b?.error) msg = `koda-scorer: ${b.error}`; } catch { /* cuerpo no-JSON */ }
    }
    throw new Error(msg);
  }
  const r = (data ?? {}) as { calificados?: number; pendientes?: boolean };
  return { calificados: r.calificados ?? 0, pendientes: Boolean(r.pendientes) };
}
