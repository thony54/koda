import { Link } from 'react-router-dom';
import { Brain, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui';
import { ScoreBadge } from '@/components/prospects/ScoreBadge';
import { useParaTi } from '@/hooks/useEspacio';
import { lineaAprendida, razonesDeEncaje } from '@/lib/aprendizaje';

/**
 * "Para ti hoy": los prospectos que mejor encajan con ESTE usuario y que aún no ha
 * trabajado, con la razón dicha en claro. Se reordena sola cada vez que KODA aprende.
 */
export function ParaTi({ enabled = true }: { enabled?: boolean }) {
  const { data } = useParaTi(enabled);
  if (!enabled || !data?.length) return null;

  return (
    <Card className="mb-5" padding="none">
      <div className="flex items-start gap-3 px-5 pb-3 pt-5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface-elevated text-accent-text">
          <Brain className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="card-title">Para ti hoy</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Los que mejor encajan contigo y todavía no has trabajado. Cambian a medida que KODA te conoce.
          </p>
        </div>
      </div>
      <ul className="divide-hair">
        {data.map((p) => {
          const razones = razonesDeEncaje(p.score_desglose, 2);
          const aprendida = lineaAprendida(p.score_desglose);
          return (
            <li key={p.id}>
              <Link
                to={`/prospectos/${p.id}`}
                className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-veil/[0.04]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink-primary">{p.nombre}</p>
                  <p className="truncate text-xs capitalize text-ink-muted">
                    {[p.categoria, p.ciudad].filter(Boolean).join(' · ')}
                  </p>
                  {(razones.length > 0 || aprendida) && (
                    <p className="mt-1 truncate text-xs text-ink-secondary">
                      {razones.length > 0 && <span>{razones.join(' · ').replace(/^./, (c) => c.toUpperCase())}</span>}
                      {aprendida && (
                        <span className={aprendida.puntos > 0 ? 'ml-2 text-success' : 'ml-2 text-danger'}>
                          {aprendida.puntos > 0 ? '· se parece a lo que aceptaste' : '· se parece a lo que descartaste'}
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <ScoreBadge score={p.score} />
                <ChevronRight className="h-4 w-4 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
