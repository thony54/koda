/**
 * Capa de acceso a datos de prospectos — implementación Supabase.
 * Las firmas son estables: la UI (hooks/páginas) no cambia si mañana se ajusta
 * la consulta. Lee/escribe con la ANON key + RLS (el usuario debe estar activo;
 * escribir exige rol staff).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Prospect, ProspectStatus, ProspectType, DashboardStats } from '@/types/domain';
import type { ProspectRow } from '@/types/database';
import { bandForScore, type ScoreBand } from '@/components/prospects/ScoreBadge';
import { slug } from '@/lib/format';
import { rowToProspect, prospectToInsertRow } from './mappers';

/**
 * Handle sin tipar para la capa de datos. Los `select` con joins embebidos no
 * se infieren bien contra el stub de tipos; aquí mapeamos las filas a dominio a
 * mano. Cuando generes los tipos reales (`npm run types`) puedes quitar el cast.
 */
const db = supabase as unknown as SupabaseClient;

const SELECT_LIST = '*, sources(nombre)';
const SELECT_DETAIL =
  '*, sources(nombre), prospect_contacts(*), prospect_signals(*), ' +
  'notes(*, profiles(nombre,email)), activities(*, profiles(nombre,email))';

export interface ProspectFilters {
  search?: string;
  ciudad?: string[];
  tipo?: ProspectType[];
  banda?: ScoreBand[];
  status?: ProspectStatus[];
  tieneWeb?: 'si' | 'no';
  source?: string[];
}

export type SortField = 'score' | 'nombre' | 'ciudad' | 'reviews_count' | 'last_seen_at';
export type SortDir = 'asc' | 'desc';

export interface ListParams extends ProspectFilters {
  sortBy?: SortField;
  sortDir?: SortDir;
  page?: number;
  pageSize?: number;
}

export interface ListResult {
  rows: Prospect[];
  total: number;
  page: number;
  pageSize: number;
}

const BAND_RANGE: Record<ScoreBand, [number, number]> = {
  hot: [75, 100],
  good: [50, 74],
  warm: [25, 49],
  cold: [0, 24],
};

async function resolveSourceIds(names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const { data } = await db.from('sources').select('id, nombre').in('nombre', names);
  return (data ?? []).map((s) => s.id);
}

export async function listProspects(params: ListParams = {}): Promise<ListResult> {
  const {
    sortBy = 'score', sortDir = 'desc', page = 1, pageSize = 15, ...f
  } = params;

  let query = db.from('prospects').select(SELECT_LIST, { count: 'exact' });

  if (f.search) {
    const q = f.search.replace(/[%,]/g, ' ').trim();
    query = query.or(`nombre.ilike.%${q}%,categoria.ilike.%${q}%`);
  }
  if (f.ciudad?.length) query = query.in('ciudad', f.ciudad);
  if (f.tipo?.length) query = query.in('tipo', f.tipo);
  if (f.status?.length) query = query.in('status', f.status);
  if (f.tieneWeb) query = query.eq('tiene_website', f.tieneWeb === 'si');
  if (f.source?.length) {
    const ids = await resolveSourceIds(f.source);
    query = query.in('source_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  }
  if (f.banda?.length) {
    const clauses = f.banda.map((b) => {
      const [lo, hi] = BAND_RANGE[b];
      return `and(score.gte.${lo},score.lte.${hi})`;
    });
    query = query.or(clauses.join(','));
  }

  query = query.order(sortBy, { ascending: sortDir === 'asc' });
  const from = (page - 1) * pageSize;
  query = query.range(from, from + pageSize - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    rows: (data ?? []).map((r) => rowToProspect(r as ProspectRow)),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function getProspect(id: string): Promise<Prospect | null> {
  const { data, error } = await db
    .from('prospects')
    .select(SELECT_DETAIL)
    .eq('id', id)
    .order('created_at', { foreignTable: 'activities', ascending: true })
    .order('created_at', { foreignTable: 'notes', ascending: false })
    .maybeSingle();
  if (error) throw error;
  return data ? rowToProspect(data as unknown as ProspectRow) : null;
}

export async function updateProspect(
  id: string,
  patch: Partial<Pick<Prospect, 'status' | 'assigned_to' | 'opt_out' | 'verified_at'>>,
): Promise<Prospect | null> {
  const { data, error } = await db
    .from('prospects')
    .update(patch)
    .eq('id', id)
    .select(SELECT_LIST)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToProspect(data as ProspectRow) : null;
}

export async function getFilterFacets() {
  const [{ data: cities }, { data: sources }] = await Promise.all([
    db.from('prospects').select('ciudad'),
    db.from('sources').select('nombre').order('nombre'),
  ]);
  const ciudades = [...new Set((cities ?? []).map((c) => c.ciudad).filter(Boolean))] as string[];
  return {
    ciudades: ciudades.sort(),
    sources: (sources ?? []).map((s) => s.nombre),
  };
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await db
    .from('prospects')
    .select('id, nombre, categoria, ciudad, score, plan_sugerido, status, assigned_to, first_seen_at');
  if (error) throw error;
  const all = data ?? [];

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = now.getTime() - 7 * 864e5;

  const nuevosHoy = all.filter((p) => new Date(p.first_seen_at).getTime() >= startOfDay).length;
  const nuevosSemana = all.filter((p) => new Date(p.first_seen_at).getTime() >= weekAgo).length;
  const calientesSinAsignar = all.filter((p) => (p.score ?? 0) >= 75 && !p.assigned_to).length;
  const clientes = all.filter((p) => p.status === 'cliente').length;

  const porDia: { fecha: string; cantidad: number }[] = [];
  for (let d = 29; d >= 0; d--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
    const next = day.getTime() + 864e5;
    const cantidad = all.filter((p) => {
      const t = new Date(p.first_seen_at).getTime();
      return t >= day.getTime() && t < next;
    }).length;
    porDia.push({ fecha: day.toLocaleDateString('es-EC', { day: '2-digit', month: 'short' }), cantidad });
  }

  const topCalientes = [...all]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 10)
    .map((r) => rowToProspect(r as ProspectRow));

  const bandCount: Record<ScoreBand, number> = { hot: 0, good: 0, warm: 0, cold: 0 };
  all.forEach((p) => { bandCount[bandForScore(p.score ?? 0)]++; });
  const bandLabels: Record<ScoreBand, string> = { hot: 'Caliente', good: 'Bueno', warm: 'Tibio', cold: 'Frío' };
  const porBanda = (Object.keys(bandCount) as ScoreBand[]).map((b) => ({ banda: bandLabels[b], cantidad: bandCount[b] }));

  return {
    total: all.length,
    nuevosHoy,
    nuevosSemana,
    calientesSinAsignar,
    clientes,
    costoApisMes: 0, // se calcula de job_runs cuando exista ingesta (Fase 2)
    porDia,
    topCalientes,
    porBanda,
  };
}

/** Inserta prospectos (importación / curaduría) con sus contactos y señales. */
export async function addProspects(newOnes: Prospect[]): Promise<number> {
  if (!newOnes.length) return 0;

  // Resolver source_id por nombre (una vez).
  const names = [...new Set(newOnes.map((p) => p.source_nombre).filter(Boolean))] as string[];
  const { data: srcRows } = await db.from('sources').select('id, nombre').in('nombre', names);
  const srcId = new Map((srcRows ?? []).map((s) => [s.nombre, s.id]));

  const rows = newOnes.map((p) => prospectToInsertRow(p, srcId.get(p.source_nombre ?? '') ?? null));
  const { data: inserted, error } = await db.from('prospects').insert(rows).select('id');
  if (error) throw error;

  const ids = (inserted ?? []).map((r) => r.id);

  // Contactos y señales por prospecto insertado (mismo orden).
  const contacts = newOnes.flatMap((p, i) =>
    (p.contactos ?? []).map((c) => ({
      prospect_id: ids[i], tipo: c.tipo, valor: c.valor, etiqueta: c.etiqueta ?? null, verificado: c.verificado,
    })),
  );
  const signals = newOnes.flatMap((p, i) =>
    (p.signals ?? []).map((s) => ({ prospect_id: ids[i], clave: s.clave, peso: s.peso })),
  );
  if (contacts.length) await db.from('prospect_contacts').insert(contacts);
  if (signals.length) await db.from('prospect_signals').insert(signals);

  return ids.length;
}

/** Claves de dedupe existentes (slug(nombre)|slug(ciudad)) para la importación. */
export async function getDedupeKeys(): Promise<Set<string>> {
  const { data } = await db.from('prospects').select('nombre, ciudad');
  return new Set((data ?? []).map((p) => `${slug(p.nombre)}|${slug(p.ciudad ?? '')}`));
}
