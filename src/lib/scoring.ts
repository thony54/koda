/**
 * Reglas del KODA Score (semilla de la sección 6.1) y utilidades de banda.
 * En producción estas reglas viven en la tabla `scoring_rules` y las edita el
 * equipo desde el panel; aquí sirven como catálogo para explicar el desglose.
 */
import type { ScoreBand } from '@/components/prospects/ScoreBadge';

export interface ScoringRule {
  clave: string;
  descripcion: string;
  puntos: number;
}

export const SCORING_RULES: ScoringRule[] = [
  { clave: 'sin_web', descripcion: 'No tiene sitio web propio', puntos: 20 },
  { clave: 'usa_linktree', descripcion: 'Usa Linktree/Beacons/similar', puntos: 15 },
  { clave: 'ig_o_fb_activo', descripcion: 'Red social con actividad reciente', puntos: 12 },
  { clave: 'whatsapp_publico', descripcion: 'Publica número de WhatsApp', puntos: 10 },
  { clave: 'resenas_10_plus', descripcion: '10 o más reseñas en Google', puntos: 10 },
  { clave: 'rating_4_plus', descripcion: 'Calificación ≥ 4.0', puntos: 8 },
  { clave: 'ciudad_objetivo', descripcion: 'Ciudad con vendedor asignado', puntos: 10 },
  { clave: 'rubro_con_plantilla', descripcion: 'Rubro con plantilla de Connexo', puntos: 8 },
  { clave: 'contacto_directo', descripcion: 'Teléfono o email verificable', puntos: 7 },
  { clave: 'web_rota_o_lenta', descripcion: 'Web con error o no responsive', puntos: 12 },
  { clave: 'multi_sucursal', descripcion: 'Aparece en varias ubicaciones', puntos: 6 },
  { clave: 'cerrado_permanente', descripcion: 'Google lo marca como cerrado', puntos: -60 },
  { clave: 'sin_ningun_contacto', descripcion: 'No hay forma de contactarlo', puntos: -25 },
  { clave: 'ya_es_cliente', descripcion: 'Coincide con Connexo Clients', puntos: -100 },
  { clave: 'opt_out', descripcion: 'Pidió no ser contactado', puntos: -100 },
];

export const RULE_BY_KEY = Object.fromEntries(
  SCORING_RULES.map((r) => [r.clave, r]),
);

export function clampScore(sum: number): number {
  return Math.max(0, Math.min(100, sum));
}

export const BAND_META: Record<
  ScoreBand,
  { label: string; emoji: string; range: string; accion: string }
> = {
  hot: {
    label: 'Caliente',
    emoji: '🔥',
    range: '75–100',
    accion: 'Notificación inmediata a #koda-hot',
  },
  good: {
    label: 'Bueno',
    emoji: '⭐',
    range: '50–74',
    accion: 'Resumen diario en #koda-nuevos',
  },
  warm: {
    label: 'Tibio',
    emoji: '🌱',
    range: '25–49',
    accion: 'Solo en la base, aparece en reportes',
  },
  cold: {
    label: 'Frío',
    emoji: '💤',
    range: '0–24',
    accion: 'Se guarda, no se notifica',
  },
};

export const SCORE_VAR: Record<ScoreBand, string> = {
  hot: 'var(--score-hot)',
  good: 'var(--score-good)',
  warm: 'var(--score-warm)',
  cold: 'var(--score-cold)',
};
