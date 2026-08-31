import type { ScoreLine } from '@/types/domain';
import { bandForScore } from './ScoreBadge';
import { SCORE_VAR, BAND_META } from '@/lib/scoring';

/**
 * Desglose del KODA Score como barra segmentada (sección 10.2): explica el
 * puntaje de un vistazo. Nunca mostramos el número sin el porqué (sección 6.1).
 */
export function ScoreBreakdown({ score, lines }: { score: number; lines: ScoreLine[] }) {
  const band = bandForScore(score);
  const color = SCORE_VAR[band];
  const positivos = lines.filter((l) => l.puntos > 0);
  const negativos = lines.filter((l) => l.puntos < 0);
  const totalPos = positivos.reduce((a, l) => a + l.puntos, 0) || 1;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm text-ink-secondary">KODA Score</p>
          <p className="font-heading text-4xl font-bold" style={{ color }}>
            {score}
            <span className="text-lg text-ink-muted"> / 100</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold" style={{ color }}>
            {BAND_META[band].emoji} {BAND_META[band].label}
          </p>
          <p className="text-xs text-ink-muted">{BAND_META[band].accion}</p>
        </div>
      </div>

      {/* Barra segmentada */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-elevated">
        {positivos.map((l) => (
          <div
            key={l.clave}
            title={`${l.descripcion} (+${l.puntos})`}
            style={{
              width: `${(l.puntos / totalPos) * 100}%`,
              backgroundColor: color,
              opacity: 0.55 + (l.puntos / 20) * 0.45,
            }}
            className="border-r border-surface-base/40 first:rounded-l-full last:rounded-r-full"
          />
        ))}
      </div>

      {/* Detalle línea por línea */}
      <ul className="space-y-1.5 text-sm">
        {positivos.map((l) => (
          <li key={l.clave} className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-ink-secondary">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
              {l.descripcion}
            </span>
            <span className="font-medium text-emerald-400">+{l.puntos}</span>
          </li>
        ))}
        {negativos.map((l) => (
          <li key={l.clave} className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-ink-secondary">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              {l.descripcion}
            </span>
            <span className="font-medium text-red-400">{l.puntos}</span>
          </li>
        ))}
        {lines.length === 0 && (
          <li className="text-ink-muted">Sin señales evaluadas todavía.</li>
        )}
      </ul>
    </div>
  );
}
