/** Capa de datos de búsquedas (search_jobs) y sus ejecuciones (job_runs). */
import { db } from '@/lib/supabase';
import type { JobStatus } from '@/types/database';

export interface SearchJob {
  id: string;
  nombre: string;
  source_id: string | null;
  source_nombre?: string;
  query: string;
  ciudad: string | null;
  provincia: string | null;
  radio_metros: number | null;
  categorias: string[] | null;
  cron: string | null;
  activo: boolean;
  max_resultados: number | null;
  last_run_at: string | null;
  ultimo?: { status: JobStatus; encontrados: number; nuevos: number; finished_at: string | null } | null;
}

interface JobRunEmbed {
  status: JobStatus; encontrados: number; nuevos: number; finished_at: string | null; started_at: string;
}

export async function listJobs(): Promise<SearchJob[]> {
  const { data, error } = await db
    .from('search_jobs')
    .select('*, sources(nombre), job_runs(status, encontrados, nuevos, finished_at, started_at)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((j: Record<string, unknown>) => {
    const runs = (j.job_runs as JobRunEmbed[] | undefined) ?? [];
    const ultimo = [...runs].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0] ?? null;
    return {
      id: j.id as string,
      nombre: j.nombre as string,
      source_id: (j.source_id as string) ?? null,
      source_nombre: (j.sources as { nombre: string } | null)?.nombre,
      query: j.query as string,
      ciudad: (j.ciudad as string) ?? null,
      provincia: (j.provincia as string) ?? null,
      radio_metros: (j.radio_metros as number) ?? null,
      categorias: (j.categorias as string[]) ?? null,
      cron: (j.cron as string) ?? null,
      activo: Boolean(j.activo),
      max_resultados: (j.max_resultados as number) ?? null,
      last_run_at: (j.last_run_at as string) ?? null,
      ultimo,
    };
  });
}

export interface JobInput {
  nombre: string;
  source_id: string | null;
  query: string;
  ciudad?: string | null;
  radio_metros?: number;
  categorias?: string[];
  cron?: string | null;
  activo?: boolean;
  max_resultados?: number;
}

export async function upsertJob(job: JobInput & { id?: string }) {
  const { id, ...rest } = job;
  const { error } = id
    ? await db.from('search_jobs').update(rest).eq('id', id)
    : await db.from('search_jobs').insert(rest);
  if (error) throw error;
}

export async function deleteJob(id: string) {
  const { error } = await db.from('search_jobs').delete().eq('id', id);
  if (error) throw error;
}

export interface JobRun {
  id: string;
  status: JobStatus;
  started_at: string;
  finished_at: string | null;
  encontrados: number;
  nuevos: number;
  duplicados: number;
  error_mensaje: string | null;
  costo_estimado: number;
}

export async function listJobRuns(jobId: string): Promise<{ jobNombre: string | null; runs: JobRun[] }> {
  const [{ data: job }, { data: runs, error }] = await Promise.all([
    db.from('search_jobs').select('nombre').eq('id', jobId).maybeSingle(),
    db.from('job_runs').select('*').eq('job_id', jobId).order('started_at', { ascending: false }),
  ]);
  if (error) throw error;
  return { jobNombre: (job as { nombre: string } | null)?.nombre ?? null, runs: (runs ?? []) as JobRun[] };
}
