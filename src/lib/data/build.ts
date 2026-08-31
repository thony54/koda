/**
 * Construye un Prospect a partir de entrada parcial (CSV o curaduría manual),
 * calculando señales y KODA Score con las reglas de la sección 6.
 * Es la versión ligera de lo que hará `koda-normalizer` + `koda-scorer`.
 */
import type { Prospect, ProspectType, ScoreLine, PlanSugerido } from '@/types/domain';
import { RULE_BY_KEY, clampScore } from '@/lib/scoring';
import { bandForScore } from '@/components/prospects/ScoreBadge';
import { toE164EC } from '@/lib/format';

const CIUDADES_OBJETIVO = new Set(['Ibarra', 'Otavalo', 'Quito', 'Guayaquil']);
const RUBROS_CON_PLANTILLA = new Set([
  'restaurante', 'barbería', 'barberia', 'peluquería', 'peluqueria', 'inmobiliaria',
  'veterinaria', 'consultorio médico', 'tienda online', 'gastronomía', 'estética', 'estetica',
]);

export interface ProspectInput {
  nombre: string;
  tipo?: ProspectType;
  categoria?: string;
  ciudad?: string;
  telefono?: string;
  whatsapp?: string;
  email?: string;
  website?: string;
  instagram?: string;
  tiktok?: string;
  usa_linktree?: boolean;
  ig_activo?: boolean;
  reviews_count?: number;
  rating?: number;
  source_nombre?: string;
  ong_referente?: string;
}

function planFor(input: ProspectInput, tiene_website: boolean, score: number): PlanSugerido {
  if (input.tipo === 'empresa' || (input.tipo === 'creador_contenido' && (input.reviews_count ?? 0) > 200)) return 'ULTRA';
  if ((input.tipo === 'emprendimiento' || input.tipo === 'profesional_independiente') && !tiene_website && (input.reviews_count ?? 0) < 10) return 'CONECTA';
  return score >= 50 ? 'PRO' : 'CONECTA';
}

let importCounter = 0;

export function buildProspectFromInput(input: ProspectInput): Prospect {
  const now = new Date().toISOString();
  const tiene_website = Boolean(input.website);
  const categoria = (input.categoria ?? '').toLowerCase();

  const signals: string[] = [];
  if (!tiene_website) signals.push('sin_web');
  if (input.usa_linktree) signals.push('usa_linktree');
  if (input.ig_activo) signals.push('ig_o_fb_activo');
  if (input.whatsapp) signals.push('whatsapp_publico');
  if ((input.reviews_count ?? 0) >= 10) signals.push('resenas_10_plus');
  if ((input.rating ?? 0) >= 4.0) signals.push('rating_4_plus');
  if (input.ciudad && CIUDADES_OBJETIVO.has(input.ciudad)) signals.push('ciudad_objetivo');
  if (categoria && RUBROS_CON_PLANTILLA.has(categoria)) signals.push('rubro_con_plantilla');
  if (input.whatsapp || input.telefono || input.email) signals.push('contacto_directo');
  if (!input.whatsapp && !input.telefono && !input.email && !input.instagram) signals.push('sin_ningun_contacto');

  const desglose: ScoreLine[] = signals.map((clave) => ({
    clave,
    descripcion: RULE_BY_KEY[clave]?.descripcion ?? clave,
    puntos: RULE_BY_KEY[clave]?.puntos ?? 0,
  }));
  const score = clampScore(desglose.reduce((a, l) => a + l.puntos, 0));

  const contactos = [];
  importCounter++;
  if (input.telefono) contactos.push({ id: `imp-${importCounter}-tel`, tipo: 'telefono' as const, valor: toE164EC(input.telefono) ?? input.telefono, verificado: false });
  if (input.whatsapp) contactos.push({ id: `imp-${importCounter}-wa`, tipo: 'whatsapp' as const, valor: toE164EC(input.whatsapp) ?? input.whatsapp, verificado: false });
  if (input.email) contactos.push({ id: `imp-${importCounter}-em`, tipo: 'email' as const, valor: input.email, verificado: false });

  return {
    id: `imp-${Date.now()}-${importCounter}`,
    nombre: input.nombre,
    tipo: input.tipo ?? 'negocio_local',
    categoria: input.categoria,
    pais: 'EC',
    ciudad: input.ciudad,
    website: input.website,
    tiene_website,
    usa_linktree: Boolean(input.usa_linktree),
    instagram: input.instagram?.replace(/^@/, ''),
    tiktok: input.tiktok?.replace(/^@/, ''),
    whatsapp: input.whatsapp ? toE164EC(input.whatsapp) ?? undefined : undefined,
    rating: input.rating,
    reviews_count: input.reviews_count,
    score,
    score_desglose: desglose,
    plan_sugerido: planFor(input, tiene_website, score),
    status: 'nuevo',
    opt_out: false,
    source_nombre: input.source_nombre ?? 'Importación CSV',
    ong_referente: input.ong_referente,
    first_seen_at: now,
    last_seen_at: now,
    contactos,
    signals: desglose.map((l, j) => ({ id: `impsig-${importCounter}-${j}`, clave: l.clave, peso: l.puntos, detectado_at: now })),
    notas: [],
    actividades: [{ id: `impact-${importCounter}`, tipo: 'creacion', detalle: `Importado — banda ${bandForScore(score)}`, autor: 'Importación', created_at: now }],
    created_at: now,
    updated_at: now,
  };
}
