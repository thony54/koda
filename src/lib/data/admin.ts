/**
 * Capa de datos de administración: reglas de scoring, fuentes, usuarios,
 * supresión (privacidad) y auditoría. Todo contra Supabase con RLS.
 */
import { db } from '@/lib/supabase';
import { byOwner } from '@/lib/scope';
import type { PermissionKey, UserRole } from '@/types/database';

// ── Reglas de scoring ───────────────────────────────────────────────────────
export interface ScoringRule {
  id: string;
  clave: string;
  descripcion: string;
  puntos: number;
  activa: boolean;
  orden: number;
}

export async function listScoringRules(): Promise<ScoringRule[]> {
  const { data, error } = await db
    .from('scoring_rules')
    .select('*')
    .order('orden', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ScoringRule[];
}

export async function upsertScoringRule(rule: Partial<ScoringRule> & { clave: string }) {
  const { error } = await db.from('scoring_rules').upsert(rule, { onConflict: 'clave' });
  if (error) throw error;
}

export async function updateScoringRule(id: string, patch: Partial<ScoringRule>) {
  const { error } = await db.from('scoring_rules').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteScoringRule(id: string) {
  const { data, error } = await db.from('scoring_rules').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('No se eliminó la regla. Las reglas de scoring solo las gestiona el Super Admin.');
  }
}

/** Base para el simulador: cada prospecto con las claves de señales que disparó. */
export interface SimBase {
  id: string;
  nombre: string;
  ciudad: string | null;
  claves: string[];
}

export async function getSimulationBase(): Promise<SimBase[]> {
  const { data, error } = await byOwner(
    db.from('prospects').select('id, nombre, ciudad, score_desglose'),
  );
  if (error) throw error;
  return (data ?? []).map((r: { id: string; nombre: string; ciudad: string | null; score_desglose: unknown }) => ({
    id: r.id,
    nombre: r.nombre,
    ciudad: r.ciudad,
    claves: Array.isArray(r.score_desglose)
      ? (r.score_desglose as { clave: string }[]).map((l) => l.clave)
      : [],
  }));
}

// ── Fuentes ─────────────────────────────────────────────────────────────────
export interface Source {
  id: string;
  nombre: string;
  tipo: string;
  base_url: string | null;
  activo: boolean;
  rate_limit_por_min: number;
}

export async function listSources(): Promise<Source[]> {
  const { data, error } = await db
    .from('sources')
    .select('id, nombre, tipo, base_url, activo, rate_limit_por_min')
    .order('nombre');
  if (error) throw error;
  return (data ?? []) as Source[];
}

export async function upsertSource(s: Partial<Source>) {
  const { error } = s.id
    ? await db.from('sources').update(s).eq('id', s.id)
    : await db.from('sources').insert(s);
  if (error) throw error;
}

export async function deleteSource(id: string) {
  const { data, error } = await db.from('sources').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('No se eliminó la fuente. Las fuentes solo las gestiona el Super Admin.');
  }
}

// ── Usuarios (profiles) ─────────────────────────────────────────────────────
export interface UserProfile {
  id: string;
  email: string;
  nombre: string | null;
  rol: UserRole;
  activo: boolean;
  es_propietario: boolean;
  permisos: PermissionKey[];
  tope_costo_mensual: number | null;
  creado_por: string | null;
  created_at: string;
}

export async function listUsers(): Promise<UserProfile[]> {
  const { data, error } = await db
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as UserProfile[]).map((u) => ({ ...u, permisos: u.permisos ?? [] }));
}

export interface UserPatch {
  nombre?: string;
  rol?: UserRole;
  activo?: boolean;
  permisos?: PermissionKey[];
  tope_costo_mensual?: number | null;
}

export async function updateUser(id: string, patch: UserPatch) {
  // Con RLS, un UPDATE sin permiso afecta 0 filas y no lanza error: lo detectamos.
  const { data, error } = await db.from('profiles').update(patch).eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('No se pudo actualizar el usuario. Solo el Super Admin puede hacerlo.');
  }
}

/** Actividad y consumo por usuario (solo Super Admin; RPC admin_user_stats). */
export interface UserStats {
  user_id: string;
  prospectos: number;
  calientes: number;
  busquedas: number;
  costo_mes: number;
  ultimo_acceso: string | null;
  tiene_google: boolean;
  tiene_discord: boolean;
}

export async function getUserStats(): Promise<UserStats[]> {
  const { data, error } = await db.rpc('admin_user_stats');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    user_id: r.user_id as string,
    prospectos: Number(r.prospectos ?? 0),
    calientes: Number(r.calientes ?? 0),
    busquedas: Number(r.busquedas ?? 0),
    costo_mes: Number(r.costo_mes ?? 0),
    ultimo_acceso: (r.ultimo_acceso as string) ?? null,
    tiene_google: Boolean(r.tiene_google),
    tiene_discord: Boolean(r.tiene_discord),
  }));
}

// ── Privacidad: supresión ───────────────────────────────────────────────────
export interface DeletionRequest {
  id: string;
  prospect_hash: string;
  motivo: string | null;
  solicitado_por: string | null;
  created_at: string;
}

export async function listDeletionRequests(): Promise<DeletionRequest[]> {
  const { data, error } = await db
    .from('deletion_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as DeletionRequest[];
}

// ── Reportes ────────────────────────────────────────────────────────────────
export interface ReportBucket { label: string; cantidad: number }
export interface ReportData {
  total: number;
  porCiudad: ReportBucket[];
  porRubro: ReportBucket[];
  porFuente: ReportBucket[];
  porStatus: ReportBucket[];
  porMes: ReportBucket[];
}

const STATUS_ORDER = [
  'nuevo', 'calificado', 'en_contacto', 'interesado', 'negociacion', 'cliente', 'descartado', 'no_contactar',
];

export async function getReportData(): Promise<ReportData> {
  const { data, error } = await byOwner(
    db.from('prospects').select('ciudad, categoria, source_id, status, first_seen_at, sources(nombre)'),
  );
  if (error) throw error;
  const rows = (data ?? []) as unknown as {
    ciudad: string | null; categoria: string | null; status: string;
    first_seen_at: string; sources?: { nombre: string } | null;
  }[];

  const tally = (keyFn: (r: (typeof rows)[number]) => string | null | undefined): ReportBucket[] => {
    const m = new Map<string, number>();
    rows.forEach((r) => {
      const k = keyFn(r) || '—';
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return [...m.entries()].map(([label, cantidad]) => ({ label, cantidad })).sort((a, b) => b.cantidad - a.cantidad);
  };

  const porStatus = STATUS_ORDER
    .map((s) => ({ label: s, cantidad: rows.filter((r) => r.status === s).length }))
    .filter((b) => b.cantidad > 0);

  const porMes = tally((r) =>
    new Date(r.first_seen_at).toLocaleDateString('es-EC', { month: 'short', year: '2-digit' }),
  ).reverse();

  return {
    total: rows.length,
    porCiudad: tally((r) => r.ciudad).slice(0, 10),
    porRubro: tally((r) => r.categoria).slice(0, 10),
    porFuente: tally((r) => r.sources?.nombre),
    porStatus,
    porMes,
  };
}

// ── Auditoría ───────────────────────────────────────────────────────────────
export interface AuditEntry {
  id: string;
  actor_id: string | null;
  accion: string;
  entidad: string | null;
  entidad_id: string | null;
  created_at: string;
}

export async function listAuditLog(limit = 100): Promise<AuditEntry[]> {
  const { data, error } = await db
    .from('audit_log')
    .select('id, actor_id, accion, entidad, entidad_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AuditEntry[];
}
