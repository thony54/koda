/**
 * Insignia del KODA Score con color por banda (sección 6.2 / 10.1).
 * Nunca mostrar el número sin contexto: el tooltip lleva la banda.
 */

export type ScoreBand = 'hot' | 'good' | 'warm' | 'cold';

export function bandForScore(score: number): ScoreBand {
  if (score >= 75) return 'hot';
  if (score >= 50) return 'good';
  if (score >= 25) return 'warm';
  return 'cold';
}

const bandMeta: Record<ScoreBand, { label: string; emoji: string; varName: string }> = {
  hot: { label: 'Caliente', emoji: '🔥', varName: '--score-hot' },
  good: { label: 'Bueno', emoji: '⭐', varName: '--score-good' },
  warm: { label: 'Tibio', emoji: '🌱', varName: '--score-warm' },
  cold: { label: 'Frío', emoji: '💤', varName: '--score-cold' },
};

interface ScoreBadgeProps {
  score: number;
  showLabel?: boolean;
}

/** Mezcla el color de banda con transparente (los tokens son var(), no hex). */
const tint = (color: string, pct: number) =>
  `color-mix(in srgb, ${color} ${pct}%, transparent)`;

export function ScoreBadge({ score, showLabel = false }: ScoreBadgeProps) {
  const band = bandForScore(score);
  const meta = bandMeta[band];
  const color = `var(${meta.varName})`;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-medium"
      style={{
        color,
        borderColor: tint(color, 38),
        backgroundColor: tint(color, 11),
        boxShadow: band === 'hot' ? `0 0 14px -4px ${tint(color, 70)}` : undefined,
      }}
      title={`${meta.emoji} ${meta.label} — ${score}/100`}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 6px ${tint(color, 80)}` }}
        aria-hidden
      />
      <span className="num">{score}</span>
      {showLabel && <span className="font-normal">· {meta.label}</span>}
    </span>
  );
}
