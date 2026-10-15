import type { ScoreLine } from '@/types/domain';
import { bandForScore, type ScoreBand } from './ScoreBadge';
import { SCORE_VAR, BAND_META } from '@/lib/scoring';

/** Zonas del medidor: cada una se llena con el color de su propia banda. */
const ZONES: { band: ScoreBand; from: number }[] = [
  { band: 'cold', from: 0 },
  { band: 'warm', from: 25 },
  { band: 'good', from: 50 },
  { band: 'hot', from: 75 },
];

/**
 * Desglose del KODA Score (sección 10.2): medidor de 4 zonas + cada regla con
 * su aporte. Nunca mostramos el número sin el porqué (sección 6.1).
 */
export function ScoreBreakdown({ score, lines }: { score: number; lines: ScoreLine[] }) {
  const band = bandForScore(score);
  const color = SCORE_VAR[band];
  const positivos = lines.filter((l) => l.puntos > 0);
  const negativos = lines.filter((l) => l.puntos < 0);
  const maxPts = Math.max(1, ...lines.map((l) => Math.abs(l.puntos)));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">KODA Score</p>
          <p className="num mt-1 text-[44px] font-semibold leading-none" style={{ color }}>
            {score}
            <span className="ml-1.5 text-base font-normal text-ink-muted">/ 100</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-base font-semibold" style={{ color }}>
            {BAND_META[band].emoji} {BAND_META[band].label}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">{BAND_META[band].accion}</p>
        </div>
      </div>

      {/* Medidor de 4 zonas */}
      <div>
        <div className="flex h-2 gap-[3px]">
          {ZONES.map((z) => {
            const fill = Math.max(0, Math.min(1, (score - z.from) / 25));
            return (
              <div key={z.band} className="relative flex-1 overflow-hidden rounded-full bg-veil/[0.07]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${fill * 100}%`,
                    backgroundColor: SCORE_VAR[z.band],
                    boxShadow: fill > 0 ? `0 0 10px ${SCORE_VAR[z.band]}` : undefined,
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="num mt-2 flex justify-between text-[10px] text-ink-muted">
          {['0', '25', '50', '75', '100'].map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </div>

      {/* Aporte de cada regla */}
      <ul className="space-y-3.5 text-sm">
        {[...positivos, ...negativos].map((l) => {
          const pos = l.puntos > 0;
          return (
            <li key={l.clave}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-secondary">{l.descripcion}</span>
                <span className={`num font-medium ${pos ? 'text-success' : 'text-danger'}`}>
                  {pos ? `+${l.puntos}` : l.puntos}
                </span>
              </div>
              <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-veil/[0.06]">
                <div
                  className={`h-full rounded-full ${pos ? 'bg-success/70' : 'bg-danger/70'}`}
                  style={{ width: `${(Math.abs(l.puntos) / maxPts) * 100}%` }}
                />
              </div>
            </li>
          );
        })}
        {lines.length === 0 && (
          <li className="text-ink-muted">Sin señales evaluadas todavía.</li>
        )}
      </ul>
    </div>
  );
}
