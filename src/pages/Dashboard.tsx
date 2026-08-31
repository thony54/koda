import { Link } from 'react-router-dom';
import {
  Users, Flame, TrendingUp, DollarSign, CheckCircle2, Loader2,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { Card } from '@/components/ui';
import { PageHeader } from '@/components/layout/PageHeader';
import { ScoreBadge } from '@/components/prospects/ScoreBadge';
import { useAuth } from '@/hooks/useAuth';
import { useDashboard } from '@/hooks/useDashboard';
import { formatUSD } from '@/lib/format';

export default function Dashboard() {
  const { profile } = useAuth();
  const { data, isLoading } = useDashboard();
  const nombre = profile?.nombre?.split(' ')[0] || 'de nuevo';

  return (
    <div>
      <PageHeader
        title={`Hola, ${nombre}`}
        description="Resumen del embudo de prospección de Connexo."
      />

      {isLoading || !data ? (
        <div className="grid place-items-center py-20 text-ink-muted">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi label="Prospectos totales" value={data.total} icon={<Users className="h-5 w-5" />} />
            <Kpi label="Nuevos esta semana" value={data.nuevosSemana} sub={`${data.nuevosHoy} hoy`} icon={<TrendingUp className="h-5 w-5" />} />
            <Kpi label="Calientes sin asignar" value={data.calientesSinAsignar} icon={<Flame className="h-5 w-5" />} accent />
            <Kpi label="Costo APIs (mes)" value={formatUSD(data.costoApisMes)} icon={<DollarSign className="h-5 w-5" />} />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Gráfico 30 días */}
            <Card className="lg:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-heading text-lg text-ink-primary">Prospectos por día</h2>
                <span className="text-xs text-ink-muted">Últimos 30 días</span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.porDia} margin={{ left: -20, right: 8, top: 4 }}>
                    <defs>
                      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ff6600" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#ff6600" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(150,39,0,0.2)" vertical={false} />
                    <XAxis dataKey="fecha" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} interval={5} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={40} />
                    <Tooltip
                      contentStyle={{ background: 'var(--background-card)', border: '1px solid var(--card-border)', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: 'var(--text-primary)' }}
                    />
                    <Area type="monotone" dataKey="cantidad" stroke="#ff6600" strokeWidth={2} fill="url(#g)" name="Prospectos" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Distribución por banda */}
            <Card>
              <h2 className="mb-4 font-heading text-lg text-ink-primary">Por banda de score</h2>
              <div className="space-y-3">
                {data.porBanda.map((b) => {
                  const pct = data.total ? (b.cantidad / data.total) * 100 : 0;
                  const color =
                    b.banda === 'Caliente' ? 'var(--score-hot)'
                    : b.banda === 'Bueno' ? 'var(--score-good)'
                    : b.banda === 'Tibio' ? 'var(--score-warm)'
                    : 'var(--score-cold)';
                  return (
                    <div key={b.banda}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="text-ink-secondary">{b.banda}</span>
                        <span className="text-ink-primary font-medium">{b.cantidad}</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-elevated">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Top calientes */}
          <Card className="mt-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-heading text-lg text-ink-primary">Top 10 calientes</h2>
              <Link to="/prospectos" className="text-sm text-[var(--primary-orange)] hover:underline">Ver todos</Link>
            </div>
            <ul className="divide-y divide-line">
              {data.topCalientes.map((p, i) => (
                <li key={p.id}>
                  <Link to={`/prospectos/${p.id}`} className="flex items-center gap-3 py-2.5 hover:bg-white/[0.02] -mx-2 px-2 rounded">
                    <span className="w-5 text-center text-sm text-ink-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink-primary">{p.nombre}</p>
                      <p className="truncate text-xs text-ink-muted capitalize">{p.categoria} · {p.ciudad}</p>
                    </div>
                    {p.status === 'cliente' && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                    {p.plan_sugerido && <span className="text-xs font-semibold text-ink-secondary">{p.plan_sugerido}</span>}
                    <ScoreBadge score={p.score} />
                  </Link>
                </li>
              ))}
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
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-ink-secondary">{label}</p>
          <p className={`mt-2 font-heading text-3xl font-bold ${accent ? 'text-[var(--score-hot)]' : 'text-ink-primary'}`}>
            {value}
          </p>
          {sub && <p className="mt-1 text-xs text-ink-muted">{sub}</p>}
        </div>
        <div className="rounded-md bg-[var(--primary-orange)]/10 p-2.5 text-[var(--primary-orange)]">
          {icon}
        </div>
      </div>
    </Card>
  );
}
