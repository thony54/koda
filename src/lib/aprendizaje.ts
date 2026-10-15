/**
 * Cómo le "habla" KODA al usuario sobre lo que aprendió. Las claves de característica
 * (cat:, ciudad:, tipo:, sig:, tok:) las define koda_features en la base (migración 0009).
 */
import { TIPO_LABEL } from '@/components/prospects/Filters';
import type { ProspectType, ScoreLine } from '@/types/domain';

/** Texto legible de una característica. `reglas` traduce las señales (sig:) a su descripción. */
export function etiquetaMemoria(feature: string, reglas: Map<string, string> = new Map()): string {
  const i = feature.indexOf(':');
  const pre = feature.slice(0, i);
  const val = feature.slice(i + 1);
  const bonito = val.replace(/_/g, ' ');
  switch (pre) {
    case 'cat': return `Rubro: ${bonito}`;
    case 'ciudad': return `Ciudad: ${bonito.replace(/\b\w/g, (c) => c.toUpperCase())}`;
    case 'tipo': return `Tipo: ${TIPO_LABEL[val as ProspectType] ?? bonito}`;
    case 'sig': return reglas.get(val) ?? bonito;
    case 'tok': return `Nombre con «${val}»`;
    default: return feature;
  }
}

/**
 * Aviso inmediato tras una decisión: qué aprendió KODA. Usa lo más reconocible
 * (rubro, ciudad y una palabra del nombre). Devuelve null si no aprendió nada.
 */
export function mensajeAprendizaje(u: { aplicado: number; features: string[] }): string | null {
  if (!u.aplicado) return null;
  const orden = (f: string) => (f.startsWith('cat:') ? 0 : f.startsWith('ciudad:') ? 1 : 2);
  const pistas = u.features
    .filter((f) => f.startsWith('cat:') || f.startsWith('ciudad:') || f.startsWith('tok:'))
    .sort((a, b) => orden(a) - orden(b))
    .filter((f, i, arr) => !f.startsWith('tok:') || arr.findIndex((x) => x.startsWith('tok:')) === i)   // una sola palabra
    .slice(0, 3)
    .map((f) => etiquetaMemoria(f));
  const detalle = pistas.length ? `: ${pistas.join(' · ')}` : '';
  return u.aplicado > 0
    ? `KODA aprendió que te interesan prospectos así${detalle}`
    : `KODA aprendió a evitar prospectos así${detalle}`;
}

/** Por qué KODA recomienda un prospecto, en una frase, a partir de su desglose (sin la línea aprendida). */
export function razonesDeEncaje(lines: ScoreLine[], max = 3): string[] {
  return lines
    .filter((l) => l.puntos > 0 && l.clave !== 'aprendizaje_koda')
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, max)
    .map((l) => l.descripcion.charAt(0).toLowerCase() + l.descripcion.slice(1));
}

export function lineaAprendida(lines: ScoreLine[]): ScoreLine | undefined {
  return lines.find((l) => l.clave === 'aprendizaje_koda');
}
