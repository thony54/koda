/**
 * Tipos de dominio de KODA (forma que consume la UI).
 * Espejo del esquema SQL de la sección 5, pero orientado al frontend.
 * Cuando se conecte Supabase, estos tipos se alinean con database.ts generado.
 */
import type { ProspectType, ProspectStatus, JobStatus } from './database';

export type { ProspectType, ProspectStatus, JobStatus };

/** Una línea del desglose del KODA Score. */
export interface ScoreLine {
  clave: string;
  descripcion: string;
  puntos: number;
}

export type PlanSugerido = 'CONECTA' | 'PRO' | 'ULTRA';

export interface ProspectContact {
  id: string;
  tipo: 'telefono' | 'email' | 'whatsapp' | 'formulario';
  valor: string;
  etiqueta?: string;
  verificado: boolean;
}

export interface ProspectSignal {
  id: string;
  clave: string;
  valor?: string;
  peso: number;
  detectado_at: string;
}

export interface Note {
  id: string;
  autor: string;
  texto: string;
  created_at: string;
}

export interface Activity {
  id: string;
  tipo: 'cambio_status' | 'nota' | 'asignacion' | 'contacto' | 'creacion';
  detalle: string;
  autor: string;
  created_at: string;
}

export interface Prospect {
  id: string;

  // identidad
  nombre: string;
  tipo: ProspectType;
  categoria?: string;
  descripcion?: string;

  // ubicación
  direccion?: string;
  ciudad?: string;
  provincia?: string;
  pais: string;
  lat?: number;
  lng?: number;

  // presencia digital
  website?: string;
  tiene_website: boolean;
  usa_linktree: boolean;
  instagram?: string;
  facebook?: string;
  tiktok?: string;
  whatsapp?: string;
  google_place_id?: string;
  google_maps_url?: string;

  // actividad
  rating?: number;
  reviews_count?: number;

  // calificación
  score: number;
  score_desglose: ScoreLine[];
  plan_sugerido?: PlanSugerido;
  status: ProspectStatus;
  opt_out: boolean;

  // trazabilidad y asignación
  source_nombre?: string;
  source_url?: string;
  first_seen_at: string;
  last_seen_at: string;
  verified_at?: string;
  assigned_to?: string;
  ong_referente?: string;

  // relaciones (cargadas en el detalle)
  contactos?: ProspectContact[];
  signals?: ProspectSignal[];
  notas?: Note[];
  actividades?: Activity[];

  created_at: string;
  updated_at: string;
}

export interface SearchJob {
  id: string;
  nombre: string;
  source_nombre: string;
  query: string;
  ciudad?: string;
  activo: boolean;
  cron?: string;
  last_run_at?: string;
  ultimo_status?: JobStatus;
  ultimo_encontrados?: number;
  ultimo_nuevos?: number;
}

export interface DashboardStats {
  total: number;
  nuevosHoy: number;
  nuevosSemana: number;
  calientesSinAsignar: number;
  clientes: number;
  costoApisMes: number;
  porDia: { fecha: string; cantidad: number }[];
  topCalientes: Prospect[];
  porBanda: { banda: string; cantidad: number }[];
}
