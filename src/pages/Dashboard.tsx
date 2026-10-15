import { Link } from 'react-router-dom';
import {
  Users, Flame, TrendingUp, DollarSign, CheckCircle2, Loader2, ChevronRight, Brain,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { Card } from '@/components/ui';
import { PageHeader } from '@/components/layout/PageHeader';
import { ScoreBadge } from '@/components/prospects/ScoreBadge';
import { useAuth } from '@/hooks/useAuth';
import { useDashboard } from '@/hooks/useDashboard';
import { useMiEspacio } from '@/hooks/useEspacio';
import { formatUSD } from '@/lib/format';
import { CHART_ACCENT, axisTick, gridStroke, tooltipProps } from '@/lib/chartTheme';

const BANDA_META: Record<string, { color: string; rango: string }> = {
  Caliente: { color: 'var(--score-hot)', rango: '75–100' },
  Bueno: { color: 'var(--score-good)', rango: '50–74' },
  Tibio: { color: 'var(--score-warm)', rango: '25–49' },
  Frío: { color: 'var(--score-cold)', rango: '0–24' },
};

export default function Dashboard() {
  const { profile, isOwner } = useAuth();
  const { data, isLoading } = useDashboard();
  const { data: espacio, isSuccess: espacioListo } = useMiEspacio();
  const nombre = profile?.nombre?.split(' ')[0] || 'de nuevo';
  // Un usuario que aún no le contó a KODA qué busca recibe los puntajes generales.
  const sinEspacio = espacioListo && !espacio?.negocio && !espacio?.rubros.length
    && !espacio?.ciudades.length && !espacio?.palabras_clave.length;

  return (
    <div>
      <PageHeader
        eyebrow="Panel · Resumen"
        title={`Hola, ${nombre}`}
        description={isOwner ? 'Resumen del embudo de prospección de Connexo.' : 'Resumen de tu prospección.'}
      />

      {sinEspacio && (
        <Link to="/mi-espacio" className="mb-5 block">
          <Card ember className="flex items-center gap-4 transition-colors hover:border-accent/45">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface-elevated text-accent-text">
              <Brain className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink-primary">Enséñale a KODA qué buscas</p>
              <p className="text-sm text-ink-secondary">
                Define tu nicho (rubros, ciudades, palabras) y KODA ordena los prospectos a tu medida y aprende de tus decisiones.
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" />
          </Card>
        </Link>
      )}

      {isLoading || !data ? (
        <div className="grid place-items-center py-24 text-ink-muted">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi label="Prospectos totales" value={data.total} icon={<Users className="h-4 w-4" />} />
            <Kpi label="Nuevos esta semana" value={data.nuevosSemana} sub={`${data.nuevosHoy} hoy`} icon={<TrendingUp className="h-4 w-4" />} />
            <Kpi label="Calientes sin asignar" value={data.calientesSinAsignar} icon={<Flame className="h-4 w-4" />} accent />
            <Kpi label="Costo APIs (mes)" value={formatUSD(data.costoApisMes)} icon={<DollarSign className="h-4 w-4" />} />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Gráfico 30 días */}
            <Card className="lg:col-span-2">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="card-title">Prospectos por día</h2>
                <span className="eyebrow">Últimos 30 días</span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.porDia} margin={{ left: -20, right: 8, top: 4 }}>
                    <defs>
                      <linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_ACCENT} stopOpacity={0.32} />
                        <stop offset="100%" stopColor={CHART_ACCENT} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 4" stroke={gridStroke} vertical={false} />
                    <XAxis dataKey="fecha" tick={axisTick} interval={5} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} width={40} />
                    <Tooltip {...tooltipProps} cursor={{ stroke: 'var(--line-strong)' }} />
                    <Area
                      type="monotone"
                      dataKey="cantidad"
                      stroke={CHART_ACCENT}
                      strokeWidth={1.75}
                      fill="url(#gArea)"
                      name="Prospectos"
                      activeDot={{ r: 4, fill: CHART_ACCENT, stroke: 'rgb(var(--c-raised))', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Distribución por banda */}
            <Card>
              <div className="mb-5 flex items-center justify-between">
                <h2 className="card-title">Por banda de score</h2>
              </div>
              <div className="space-y-5">
                {data.porBanda.map((b) => {
                  const pct = data.total ? (b.cantidad / data.total) * 100 : 0;
                  const meta = BANDA_META[b.banda] ?? BANDA_META.Frío;
                  return (
                    <div key={b.banda}>
                      <div className="mb-2 flex items-baseline justify-between">
                        <span className="flex items-center gap-2 text-[13px] text-ink-primary">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: meta.color, boxShadow: `0 0 8px ${meta.color}` }}
                          />
                          {b.banda}
                          <span className="num text-[11px] text-ink-muted">{meta.rango}</span>
                        </span>
                        <span className="num text-[13px] text-ink-primary">
                          {b.cantidad}
                          <span className="ml-1.5 text-[11px] text-ink-muted">{pct.toFixed(0)}%</span>
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-veil/[0.07]">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: meta.color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Top calientes */}
          <Card className="mt-5" padding="none">
            <div className="flex items-center justify-between px-5 pb-3 pt-5">
              <h2 className="card-title">Top 10 calientes</h2>
              <Link to="/prospectos" className="text-xs font-medium text-accent-text hover:underline">
                Ver todos →
              </Link>
            </div>
            <ul className="divide-hair">
              {data.topCalientes.map((p, i) => (
                <li key={p.id}>
                  <Link
                    to={`/prospectos/${p.id}`}
                    className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-veil/[0.04]"
                  >
                    <span className={`num w-6 text-center text-[13px] ${i < 3 ? 'font-semibold text-accent-text' : 'text-ink-muted'}`}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink-primary">{p.nombre}</p>
                      <p className="truncate text-xs capitalize text-ink-muted">{p.categoria} · {p.ciudad}</p>
                    </div>
                    {p.status === 'cliente' && <CheckCircle2 className="h-4 w-4 text-success" />}
                    {isOwner && p.plan_sugerido && (
                      <span className="num hidden text-xs text-ink-secondary sm:inline">{p.plan_sugerido}</span>
                    )}
                    <ScoreBadge score={p.score} />
                    <ChevronRight className="h-4 w-4 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                </li>
              ))}
              {data.topCalientes.length === 0 && (
                <li className="px-5 py-8 text-center text-sm text-ink-muted">
                  Todavía no hay prospectos calientes.
                </li>
              )}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, icon, accent }: {
  label: string; value: string | number; sub?: string; icon: React.ReactNode; accent?: boolean;
}) {
  return (
    <Card ember={accent} className="relative">
      <div className="flex items-start justify-between gap-2">
        <p className="eyebrow">{label}</p>
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border ${
            accent
              ? 'border-accent/35 bg-accent/10 text-accent-text'
              : 'border-line-strong bg-surface-elevated text-ink-secondary'
          }`}
        >
          {icon}
        </span>
      </div>
      <p
        className={`num mt-4 text-[34px] font-semibold leading-none ${accent ? 'text-accent-text' : 'text-ink-primary'}`}
      >
        {value}
      </p>
      <p className="mt-2 h-4 text-xs text-ink-muted">{sub ?? ''}</p>
    </Card>
  );
}
