/**
 * Tipos de la base de datos.
 *
 * ⚠️ Este archivo se GENERA con:
 *     npm run types           (requiere supabase CLI + proyecto enlazado)
 *   o: supabase gen types typescript --project-id <ID> > src/types/database.ts
 *
 * Mientras tanto, este stub tipa las tablas que la app consulta en la Fase 1.
 * Cuando generes el tipo real (superset de esto), reemplaza el archivo completo.
 */

export type UserRole = 'super_admin' | 'analista' | 'lector';

export type ProspectType =
  | 'negocio_local'
  | 'emprendimiento'
  | 'empresa'
  | 'profesional_independiente'
  | 'creador_contenido'
  | 'organizacion';

export type ProspectStatus =
  | 'nuevo'
  | 'calificado'
  | 'en_contacto'
  | 'interesado'
  | 'negociacion'
  | 'cliente'
  | 'descartado'
  | 'no_contactar';

export type JobStatus = 'pendiente' | 'corriendo' | 'ok' | 'error' | 'cancelado';

// deno-lint-ignore no-explicit-any
type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export interface Profile {
  id: string;
  email: string;
  nombre: string | null;
  rol: UserRole;
  activo: boolean;
  created_at: string;
}

export interface ProspectRow {
  id: string;
  nombre: string;
  nombre_normalizado: string | null;
  tipo: ProspectType;
  categoria: string | null;
  descripcion: string | null;
  direccion: string | null;
  ciudad: string | null;
  provincia: string | null;
  pais: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  tiene_website: boolean | null;
  usa_linktree: boolean | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  whatsapp: string | null;
  google_place_id: string | null;
  google_maps_url: string | null;
  rating: number | null;
  reviews_count: number | null;
  score: number | null;
  score_desglose: Json;
  plan_sugerido: string | null;
  status: ProspectStatus;
  opt_out: boolean | null;
  source_id: string | null;
  source_url: string | null;
  first_seen_at: string;
  last_seen_at: string;
  verified_by: string | null;
  verified_at: string | null;
  assigned_to: string | null;
  ong_referente: string | null;
  dedupe_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactRow {
  id: string;
  prospect_id: string;
  tipo: string;
  valor: string;
  etiqueta: string | null;
  verificado: boolean | null;
  created_at: string;
}

export interface SignalRow {
  id: string;
  prospect_id: string;
  clave: string;
  valor: string | null;
  peso: number | null;
  detectado_at: string;
}

export interface NoteRow {
  id: string;
  prospect_id: string;
  autor_id: string | null;
  texto: string;
  created_at: string;
}

export interface ActivityRow {
  id: string;
  prospect_id: string;
  autor_id: string | null;
  tipo: string;
  detalle: Json;
  created_at: string;
}

export interface SourceRow {
  id: string;
  nombre: string;
  tipo: string;
  activo: boolean | null;
}

export interface ScoringRuleRow {
  id: string;
  clave: string;
  descripcion: string;
  puntos: number;
  activa: boolean | null;
  orden: number | null;
}

type TableDef<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
};

export interface Database {
  public: {
    Tables: {
      profiles: TableDef<Profile> & { Insert: Partial<Profile> & { id: string; email: string } };
      prospects: TableDef<ProspectRow>;
      prospect_contacts: TableDef<ContactRow>;
      prospect_signals: TableDef<SignalRow>;
      notes: TableDef<NoteRow>;
      activities: TableDef<ActivityRow>;
      sources: TableDef<SourceRow>;
      scoring_rules: TableDef<ScoringRuleRow>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      user_role: UserRole;
      prospect_type: ProspectType;
      prospect_status: ProspectStatus;
      job_status: JobStatus;
    };
  };
}
