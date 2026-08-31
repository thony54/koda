/** Conversión entre filas de Supabase y el modelo de dominio de la UI. */
import type {
  ProspectRow, ContactRow, SignalRow, NoteRow, ActivityRow,
} from '@/types/database';
import type {
  Prospect, ProspectContact, ProspectSignal, Note, Activity, ScoreLine, PlanSugerido,
} from '@/types/domain';

interface JoinedRow extends ProspectRow {
  sources?: { nombre: string } | null;
  prospect_contacts?: ContactRow[];
  prospect_signals?: SignalRow[];
  notes?: (NoteRow & { profiles?: { nombre: string | null; email: string } | null })[];
  activities?: (ActivityRow & { profiles?: { nombre: string | null; email: string } | null })[];
}

function asScoreLines(json: unknown): ScoreLine[] {
  if (Array.isArray(json)) return json as ScoreLine[];
  return [];
}

export function rowToProspect(row: JoinedRow): Prospect {
  return {
    id: row.id,
    nombre: row.nombre,
    tipo: row.tipo,
    categoria: row.categoria ?? undefined,
    descripcion: row.descripcion ?? undefined,
    direccion: row.direccion ?? undefined,
    ciudad: row.ciudad ?? undefined,
    provincia: row.provincia ?? undefined,
    pais: row.pais ?? 'EC',
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    website: row.website ?? undefined,
    tiene_website: Boolean(row.tiene_website),
    usa_linktree: Boolean(row.usa_linktree),
    instagram: row.instagram ?? undefined,
    facebook: row.facebook ?? undefined,
    tiktok: row.tiktok ?? undefined,
    whatsapp: row.whatsapp ?? undefined,
    google_place_id: row.google_place_id ?? undefined,
    google_maps_url: row.google_maps_url ?? undefined,
    rating: row.rating ?? undefined,
    reviews_count: row.reviews_count ?? undefined,
    score: row.score ?? 0,
    score_desglose: asScoreLines(row.score_desglose),
    plan_sugerido: (row.plan_sugerido as PlanSugerido | null) ?? undefined,
    status: row.status,
    opt_out: Boolean(row.opt_out),
    source_nombre: row.sources?.nombre ?? undefined,
    source_url: row.source_url ?? undefined,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    verified_at: row.verified_at ?? undefined,
    assigned_to: row.assigned_to ?? undefined,
    ong_referente: row.ong_referente ?? undefined,
    contactos: row.prospect_contacts?.map(mapContact),
    signals: row.prospect_signals?.map(mapSignal),
    notas: row.notes?.map(mapNote),
    actividades: row.activities?.map(mapActivity),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapContact(c: ContactRow): ProspectContact {
  return {
    id: c.id,
    tipo: c.tipo as ProspectContact['tipo'],
    valor: c.valor,
    etiqueta: c.etiqueta ?? undefined,
    verificado: Boolean(c.verificado),
  };
}

function mapSignal(s: SignalRow): ProspectSignal {
  return { id: s.id, clave: s.clave, valor: s.valor ?? undefined, peso: s.peso ?? 0, detectado_at: s.detectado_at };
}

function mapNote(n: NoteRow & { profiles?: { nombre: string | null; email: string } | null }): Note {
  return { id: n.id, autor: n.profiles?.nombre ?? n.profiles?.email ?? '—', texto: n.texto, created_at: n.created_at };
}

function mapActivity(a: ActivityRow & { profiles?: { nombre: string | null; email: string } | null }): Activity {
  const detalle = typeof a.detalle === 'string' ? a.detalle : JSON.stringify(a.detalle);
  return { id: a.id, tipo: a.tipo as Activity['tipo'], detalle, autor: a.profiles?.nombre ?? a.profiles?.email ?? 'KODA', created_at: a.created_at };
}

/** Columnas de `prospects` para insertar desde importación/curaduría. */
export function prospectToInsertRow(p: Prospect, sourceId: string | null) {
  return {
    nombre: p.nombre,
    tipo: p.tipo,
    categoria: p.categoria ?? null,
    ciudad: p.ciudad ?? null,
    pais: p.pais,
    website: p.website ?? null,
    tiene_website: p.tiene_website,
    usa_linktree: p.usa_linktree,
    instagram: p.instagram ?? null,
    tiktok: p.tiktok ?? null,
    whatsapp: p.whatsapp ?? null,
    rating: p.rating ?? null,
    reviews_count: p.reviews_count ?? null,
    score: p.score,
    score_desglose: p.score_desglose,
    plan_sugerido: p.plan_sugerido ?? null,
    status: p.status,
    source_id: sourceId,
    source_url: p.source_url ?? null,
    dedupe_hash: p.id, // placeholder único; el normalizador real calcula el hash
  };
}
