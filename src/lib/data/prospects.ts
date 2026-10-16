/**
 * Capa de acceso a datos de prospectos — implementación Supabase.
 * Las firmas son estables: la UI (hooks/páginas) no cambia si mañana se ajusta
 * la consulta. Lee/escribe con la ANON key + RLS (el usuario debe estar activo;
 * escribir exige rol staff).
 */
import { db } from '@/lib/supabase';
import { byOwner, ownerForInsert } from '@/lib/scope';
import type { Prospect, ProspectStatus, ProspectType, DashboardStats } from '@/types/domain';
import type { ProspectRow } from '@/types/database';
import { bandForScore, type ScoreBand } from '@/components/prospects/ScoreBadge';
import { slug } from '@/lib/format';
import { queryClient } from '@/lib/queryClient';
import { rowToProspect, prospectToInsertRow } from './mappers';
import { recalcularPuntajes } from './espacio';

const SELECT_LIST = '*, sources(nombre)';
const SELECT_DETAIL =
  '*, sources(nombre), prospect_contacts(*), prospect_signals(*), ' +
  'notes(*, profiles(nombre,email)), activities(*, profiles(nombre,email))';

/** Ventana de "cuándo lo encontró una búsqueda". */
export type Encontrados = 'ultima' | 'hoy' | '7d' | '30d';

export interface ProspectFilters {
  search?: string;
  ciudad?: string[];
  tipo?: ProspectType[];
  banda?: ScoreBand[];
  status?: ProspectStatus[];
  tieneWeb?: 'si' | 'no';
  source?: string[];
  /** Búsquedas (search_jobs.id) de las que salió el prospecto. */
  busqueda?: string[];
  /** Una ejecución concreta (job_runs.id): "lo que trajo esta corrida". */
  corrida?: string;
  /** Prospectos que alguna búsqueda encontró en esa ventana (o en la última corrida). */
  encontrados?: Encontrados;
  /** Solo los que la(s) búsqueda(s) CREARON, no los que ya existían. */
  soloNuevos?: boolean;
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

const NO_ID = '00000000-0000-0000-0000-000000000000';

/** La corrida más reciente que de verdad trajo resultados (de las búsquedas del usuario). */
async function getUltimaCorrida() {
  const { data } = await byOwner(
    db.from('job_runs').select('id, started_at, encontrados, nuevos, search_jobs(nombre)'),
  )
    .eq('status', 'ok')
    .gt('encontrados', 0)
    .order('started_at', { ascending: false })
    .limit(1);
  const r = (data ?? [])[0] as unknown as
    | { id: string; started_at: string; encontrados: number; nuevos: number; search_jobs: { nombre: string } | null }
    | undefined;
  return r ? { id: r.id, started_at: r.started_at, encontrados: r.encontrados, nuevos: r.nuevos, nombre: r.search_jobs?.nombre ?? 'Búsqueda' } : null;
}

/** Inicio de la ventana en hora local (para "hoy" / "últimos N días"). */
function desdeDe(e: Exclude<Encontrados, 'ultima'>): string {
  const now = new Date();
  const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (e === 'hoy') return hoy.toISOString();
  return new Date(hoy.getTime() - (e === '7d' ? 6 : 29) * 864e5).toISOString();
}

async function resolveSourceIds(names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const { data } = await db.from('sources').select('id, nombre').in('nombre', names);
  return (data ?? []).map((s) => s.id);
}

export async function listProspects(params: ListParams = {}): Promise<ListResult> {
  const {
    sortBy = 'score', sortDir = 'desc', page = 1, pageSize = 15, ...f
  } = params;

  // Filtrar por búsqueda une con prospect_runs (migración 0011): un prospecto sale una sola vez
  // aunque varias corridas lo hayan encontrado.
  const porBusqueda = Boolean(f.busqueda?.length || f.corrida || f.encontrados || f.soloNuevos);
  const columnas: string = porBusqueda ? `${SELECT_LIST}, prospect_runs!inner(run_id)` : SELECT_LIST;
  let query = byOwner(db.from('prospects').select(columnas, { count: 'exact' }));

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
  if (porBusqueda) {
    if (f.busqueda?.length) query = query.in('prospect_runs.job_id', f.busqueda);
    if (f.corrida) {
      query = query.eq('prospect_runs.run_id', f.corrida);
    } else if (f.encontrados === 'ultima') {
      const ultima = await getUltimaCorrida();
      query = query.eq('prospect_runs.run_id', ultima?.id ?? NO_ID);
    } else if (f.encontrados) {
      query = query.gte('prospect_runs.found_at', desdeDe(f.encontrados));
    }
    if (f.soloNuevos) query = query.eq('prospect_runs.nuevo', true);
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
    // `columnas` es dinámica (a veces trae el join con prospect_runs): las filas se tipan a mano.
    rows: ((data ?? []) as unknown as ProspectRow[]).map((r) => rowToProspect(r)),
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

export interface BusquedaFacet {
  id: string;
  nombre: string;
  /** Cuándo corrió por última vez con resultados (null = nunca trajo nada). */
  ultima: string | null;
  encontrados: number;
  nuevos: number;
}

export interface UltimaBusqueda {
  id: string;
  nombre: string;
  started_at: string;
  encontrados: number;
  nuevos: number;
}

export async function getFilterFacets() {
  const [{ data: cities }, { data: sources }, { data: jobs }, ultima] = await Promise.all([
    byOwner(db.from('prospects').select('ciudad')),
    db.from('sources').select('nombre').order('nombre'),
    byOwner(db.from('search_jobs').select('id, nombre, job_runs(status, encontrados, nuevos, started_at)')),
    getUltimaCorrida(),
  ]);
  const ciudades = [...new Set((cities ?? []).map((c) => c.ciudad).filter(Boolean))] as string[];

  // Las búsquedas del usuario, la que corrió más recientemente primero.
  type Run = { status: string; encontrados: number; nuevos: number; started_at: string };
  const busquedas: BusquedaFacet[] = ((jobs ?? []) as { id: string; nombre: string; job_runs: Run[] | null }[])
    .map((j) => {
      const ok = (j.job_runs ?? [])
        .filter((r) => r.status === 'ok' && r.encontrados > 0)
        .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];
      return { id: j.id, nombre: j.nombre, ultima: ok?.started_at ?? null, encontrados: ok?.encontrados ?? 0, nuevos: ok?.nuevos ?? 0 };
    })
    .sort((a, b) => (b.ultima ?? '').localeCompare(a.ultima ?? '') || a.nombre.localeCompare(b.nombre));

  return {
    ciudades: ciudades.sort(),
    sources: (sources ?? []).map((s) => s.nombre),
    busquedas,
    ultima: ultima as UltimaBusqueda | null,
  };
}

/** Datos de una ejecución concreta (para el aviso "estás viendo lo que trajo…"). */
export async function getCorridaInfo(runId: string): Promise<{ nombre: string; started_at: string; encontrados: number; nuevos: number } | null> {
  const { data } = await db
    .from('job_runs')
    .select('started_at, encontrados, nuevos, search_jobs(nombre)')
    .eq('id', runId)
    .maybeSingle();
  const r = data as { started_at: string; encontrados: number; nuevos: number; search_jobs: { nombre: string } | null } | null;
  return r ? { nombre: r.search_jobs?.nombre ?? 'Búsqueda', started_at: r.started_at, encontrados: r.encontrados, nuevos: r.nuevos } : null;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await byOwner(
    db.from('prospects')
      .select('id, nombre, categoria, ciudad, score, plan_sugerido, status, assigned_to, first_seen_at'),
  );
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

  // owner_id: por defecto es quien inserta (auth.uid()); el Super Admin viendo a otro
  // usuario inserta directamente en la base de ese usuario.
  const rows = newOnes.map((p) => ({
    ...prospectToInsertRow(p, srcId.get(p.source_nombre ?? '') ?? null),
    ...ownerForInsert(),
  }));
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

  // Los califica koda-scorer con el espacio de su dueño (nicho, plan solo del propietario).
  // Sin bloquear la importación: si falla, el cron lo hace en minutos.
  void recalcularPuntajes()
    .then(() => {
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    })
    .catch(() => undefined);

  return ids.length;
}

/** Claves de dedupe existentes (slug(nombre)|slug(ciudad)) para la importación. */
export async function getDedupeKeys(): Promise<Set<string>> {
  const { data } = await byOwner(db.from('prospects').select('nombre, ciudad'));
  return new Set((data ?? []).map((p) => `${slug(p.nombre)}|${slug(p.ciudad ?? '')}`));
}

export interface MapPoint {
  id: string; nombre: string; ciudad: string | null; categoria: string | null;
  lat: number; lng: number; score: number;
}

export async function getMapPoints(): Promise<MapPoint[]> {
  const { data, error } = await byOwner(
    db.from('prospects').select('id, nombre, ciudad, categoria, lat, lng, score'),
  )
    .not('lat', 'is', null)
    .not('lng', 'is', null);
  if (error) throw error;
  return (data ?? []) as MapPoint[];
}

export async function deleteProspect(id: string): Promise<void> {
  const { data, error } = await db.from('prospects').delete().eq('id', id).select('id');
  if (error) throw error;
  // Con RLS, un DELETE sin permiso afecta 0 filas y NO lanza error. Lo detectamos.
  if (!data || data.length === 0) {
    throw new Error('No se eliminó el prospecto. Tu usuario necesita permiso de edición y la función "Eliminar" (o "Duplicados") habilitada por el administrador.');
  }
}

export interface DupCandidate {
  id: string; nombre: string; ciudad: string | null; categoria: string | null;
  score: number; status: string; source_nombre?: string; first_seen_at: string;
  tiene_website: boolean; whatsapp: string | null;
}
export interface DupPair { a: DupCandidate; b: DupCandidate; motivo: string }

/** Detecta pares de posibles duplicados (mismo nombre+ciudad, o nombre muy similar). */
export async function findDuplicatePairs(): Promise<DupPair[]> {
  const { data, error } = await byOwner(
    db.from('prospects')
      .select('id, nombre, ciudad, categoria, score, status, source_id, first_seen_at, tiene_website, whatsapp, sources(nombre)'),
  );
  if (error) throw error;
  const rows: DupCandidate[] = (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string, nombre: r.nombre as string, ciudad: (r.ciudad as string) ?? null,
    categoria: (r.categoria as string) ?? null, score: (r.score as number) ?? 0, status: r.status as string,
    source_nombre: (r.sources as { nombre: string } | null)?.nombre,
    first_seen_at: r.first_seen_at as string, tiene_website: Boolean(r.tiene_website),
    whatsapp: (r.whatsapp as string) ?? null,
  }));

  const pairs: DupPair[] = [];
  // Agrupar por ciudad para comparar solo dentro de la misma ciudad.
  const byCity = new Map<string, DupCandidate[]>();
  rows.forEach((r) => {
    const c = slug(r.ciudad ?? '');
    if (!byCity.has(c)) byCity.set(c, []);
    byCity.get(c)!.push(r);
  });

  for (const group of byCity.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        const sa = slug(a.nombre), sb = slug(b.nombre);
        if (sa === sb) pairs.push({ a, b, motivo: 'Mismo nombre y ciudad' });
        else if (trigramSimilarity(sa, sb) >= 0.6) pairs.push({ a, b, motivo: 'Nombre muy similar' });
      }
    }
  }
  return pairs;
}

/** Similitud por trigramas (aprox. de pg_trgm) para la cola de duplicados. */
function trigramSimilarity(a: string, b: string): number {
  const tri = (s: string) => {
    const p = `  ${s} `;
    const set = new Set<string>();
    for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3));
    return set;
  };
  const ta = tri(a), tb = tri(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => { if (tb.has(t)) inter++; });
  return inter / (ta.size + tb.size - inter);
}
