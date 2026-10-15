import { Loader2, Download, Users, Flame, Handshake, CalendarClock } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';
import { Card, Button } from '@/components/ui';
import { useReportData } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { STATUS_LABEL } from '@/components/prospects/Filters';
import type { ReportBucket, ReportData } from '@/lib/data/admin';
import type { ProspectStatus } from '@/types/domain';
import { CHART_ACCENT, axisTick, gridStroke, tooltipProps } from '@/lib/chartTheme';

const BAND_COLOR: Record<string, string> = {
  Caliente: 'var(--score-hot)',
  Bueno: 'var(--score-good)',
  Tibio: 'var(--score-warm)',
  Frío: 'var(--score-cold)',
};
const BAND_RANGE: Record<string, string> = {
  Caliente: '75–100', Bueno: '50–74', Tibio: '25–49', Frío: '0–24',
};

/** Etapas del embudo comercial, en orden. Descartado / no contactar quedan aparte. */
const FUNNEL_STAGES: ProspectStatus[] = ['nuevo', 'calificado', 'en_contacto', 'interesado', 'negociacion', 'cliente'];
const FUNNEL_EXIT: ProspectStatus[] = ['descartado', 'no_contactar'];

const pct = (n: number, total: number) => (total > 0 ? (n / total) * 100 : 0);
const fmtPct = (v: number) => `${v >= 10 || v === 0 ? v.toFixed(0) : v.toFixed(1)}%`;
const labelOf = (l: string) => (l === '—' ? 'Sin dato' : l);

function exportReport(data: ReportData) {
  const lines = ['seccion,etiqueta,cantidad'];
  const push = (sec: string, buckets: ReportBucket[]) => buckets.forEach((b) => lines.push(`${sec},"${b.label}",${b.cantidad}`));
  push('ciudad', data.porCiudad); push('rubro', data.porRubro); push('fuente', data.porFuente);
  push('status', data.porStatus); push('banda', data.porBanda); push('mes', data.porMes);
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `reporte-koda-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const { data, isLoading } = useReportData();
  const { can } = useAuth();

  if (isLoading) {
    return (
      <div><PageHeader eyebrow="Analítica" title="Reportes" />
        <div className="grid place-items-center py-24 text-ink-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>
      </div>
    );
  }

  if (!data || data.total === 0) {
    return (
      <div>
        <PageHeader eyebrow="Analítica" title="Reportes" description="Por ciudad, rubro, fuente, embudo por estado y evolución mensual." />
        <EmptyState title="Sin datos para reportar" hint="Los reportes se llenan a medida que entran prospectos. Importa un CSV o ejecuta una búsqueda para empezar." />
      </div>
    );
  }

  const count = (s: ProspectStatus) => data.porStatus.find((b) => b.label === s)?.cantidad ?? 0;
  const clientes = count('cliente');
  const calientes = data.porBanda.find((b) => b.label === 'Caliente')?.cantidad ?? 0;
  const mesActual = data.porMes[data.porMes.length - 1];
  const mesPrevio = data.porMes[data.porMes.length - 2];
  const delta = mesActual && mesPrevio && mesPrevio.cantidad > 0
    ? ((mesActual.cantidad - mesPrevio.cantidad) / mesPrevio.cantidad) * 100
    : null;

  return (
    <div>
      <PageHeader
        eyebrow="Analítica"
        title="Reportes"
        description={`${data.total} prospectos analizados.`}
        actions={can('exportar')
          ? <Button variant="secondary" size="sm" onClick={() => exportReport(data)}><Download className="h-4 w-4" /> Exportar CSV</Button>
          : undefined}
      />

      {/* Cifras clave */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="Prospectos totales" value={data.total} icon={<Users className="h-4 w-4" />}
          sub={`${data.ciudadesDistintas} ciudades · ${data.rubrosDistintos} rubros`}
        />
        <Kpi
          label="Calientes" value={calientes} icon={<Flame className="h-4 w-4" />} accent
          sub={`${fmtPct(pct(calientes, data.total))} del total`}
        />
        <Kpi
          label="Clientes" value={clientes} icon={<Handshake className="h-4 w-4" />}
          sub={`${fmtPct(pct(clientes, data.total))} de conversión`}
        />
        <Kpi
          label={`Nuevos · ${mesActual?.label ?? 'este mes'}`} value={mesActual?.cantidad ?? 0} icon={<CalendarClock className="h-4 w-4" />}
          sub={delta === null ? 'sin mes previo para comparar' : `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}% vs mes anterior`}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Evolución mensual */}
        <Panel title="Evolución mensual" hint="Prospectos nuevos por mes" className="lg:col-span-2">
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.porMes} margin={{ left: -18, right: 4, top: 8 }} barCategoryGap="28%">
                <CartesianGrid strokeDasharray="2 4" stroke={gridStroke} vertical={false} />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval={0} />
                <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} width={44} />
                <Tooltip {...tooltipProps} />
                <Bar dataKey="cantidad" name="Prospectos" fill={CHART_ACCENT} radius={[4, 4, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        {/* Calidad: banda de score */}
        <Panel title="Calidad de la base" hint="Por banda de score">
          <BandSplit data={data.porBanda} total={data.total} />
        </Panel>

        <Panel title="Por ciudad" hint="Dónde está la base" className="lg:col-span-1">
          <RankList data={data.porCiudad} total={data.total} />
        </Panel>
        <Panel title="Por rubro" hint="Tipo de negocio" className="lg:col-span-1">
          <RankList data={data.porRubro} total={data.total} tone="peach" />
        </Panel>
        <Panel title="Por fuente" hint="De dónde viene" className="lg:col-span-1">
          <RankList data={data.porFuente} total={data.total} tone="muted" />
        </Panel>

        {/* Embudo */}
        <Panel title="Embudo comercial" hint="Llegaron a cada etapa o más lejos" className="lg:col-span-3">
          <Funnel
            counts={FUNNEL_STAGES.map((s, i) => ({
              stage: s,
              // Acumulado: quien ya está en "interesado" también pasó por "calificado" y "en contacto".
              cantidad: FUNNEL_STAGES.slice(i).reduce((a, st) => a + count(st), 0),
            }))}
            total={data.total}
          />
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-4 text-[13px]">
            <span className="eyebrow">Fuera del embudo</span>
            {FUNNEL_EXIT.map((s) => (
              <span key={s} className="inline-flex items-center gap-2 text-ink-secondary">
                {STATUS_LABEL[s]}
                <span className="num text-ink-primary">{count(s)}</span>
                <span className="num text-[11px] text-ink-muted">{fmtPct(pct(count(s), data.total))}</span>
              </span>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ── Piezas ──────────────────────────────────────────────────────────────── */

function Panel({ title, hint, className = '', children }: {
  title: string; hint?: string; className?: string; children: React.ReactNode;
}) {
  return (
    <Card className={className}>
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="card-title">{title}</h2>
        {hint && <span className="eyebrow truncate">{hint}</span>}
      </div>
      {children}
    </Card>
  );
}

function Kpi({ label, value, sub, icon, accent }: {
  label: string; value: string | number; sub?: string; icon: React.ReactNode; accent?: boolean;
}) {
  return (
    <Card ember={accent}>
      <div className="flex items-start justify-between gap-2">
        <p className="eyebrow">{label}</p>
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border ${
          accent ? 'border-accent/35 bg-accent/10 text-accent-text' : 'border-line-strong bg-surface-elevated text-ink-secondary'
        }`}>
          {icon}
        </span>
      </div>
      <p className={`num mt-4 text-[34px] font-semibold leading-none ${accent ? 'text-accent-text' : 'text-ink-primary'}`}>{value}</p>
      <p className="mt-2 text-xs text-ink-muted">{sub}</p>
    </Card>
  );
}

const TONE: Record<string, string> = {
  accent: 'rgb(var(--c-accent))',
  peach: 'rgb(var(--c-peach))',
  muted: 'rgb(var(--c-ink) / 0.55)',
};

/**
 * Ranking en lista: etiqueta y cifra en una línea, barra debajo. Sin ejes ni
 * etiquetas apretadas, así que nunca se montan unas sobre otras.
 */
function RankList({ data, total, limit = 6, tone = 'accent' }: {
  data: ReportBucket[]; total: number; limit?: number; tone?: 'accent' | 'peach' | 'muted';
}) {
  const top = data.slice(0, limit);
  const otros = Math.max(0, total - top.reduce((a, b) => a + b.cantidad, 0));
  const rows = otros > 0 ? [...top, { label: 'Otros', cantidad: otros }] : top;
  const max = Math.max(1, ...rows.map((r) => r.cantidad));

  if (rows.length === 0) return <p className="text-sm text-ink-muted">Sin datos.</p>;

  return (
    <ul className="space-y-4">
      {rows.map((r, i) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[13px] capitalize text-ink-primary" title={labelOf(r.label)}>
              {labelOf(r.label)}
            </span>
            <span className="num shrink-0 text-[13px] text-ink-primary">
              {r.cantidad}
              <span className="ml-2 inline-block w-10 text-right text-[11px] text-ink-muted">{fmtPct(pct(r.cantidad, total))}</span>
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-veil/[0.07]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(r.cantidad / max) * 100}%`,
                backgroundColor: r.label === 'Otros' ? 'rgb(var(--c-ink) / 0.3)' : TONE[tone],
                opacity: r.label === 'Otros' ? 1 : Math.max(0.45, 1 - i * 0.1),
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Barra segmentada por banda + leyenda con cifras. */
function BandSplit({ data, total }: { data: ReportBucket[]; total: number }) {
  return (
    <div>
      <div className="flex h-3 gap-[3px] overflow-hidden rounded-full">
        {data.filter((b) => b.cantidad > 0).map((b) => (
          <div
            key={b.label}
            title={`${b.label}: ${b.cantidad}`}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${pct(b.cantidad, total)}%`, backgroundColor: BAND_COLOR[b.label] }}
          />
        ))}
      </div>
      <ul className="mt-6 space-y-4">
        {data.map((b) => (
          <li key={b.label} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex items-center gap-2.5 text-ink-primary">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: BAND_COLOR[b.label], boxShadow: `0 0 8px ${BAND_COLOR[b.label]}` }}
              />
              {b.label}
              <span className="num text-[11px] text-ink-muted">{BAND_RANGE[b.label]}</span>
            </span>
            <span className="num text-ink-primary">
              {b.cantidad}
              <span className="ml-2 inline-block w-10 text-right text-[11px] text-ink-muted">{fmtPct(pct(b.cantidad, total))}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Embudo: barra por etapa (relativa a la etapa más grande) y paso a paso desde la anterior. */
function Funnel({ counts, total }: { counts: { stage: ProspectStatus; cantidad: number }[]; total: number }) {
  const max = Math.max(1, ...counts.map((c) => c.cantidad));
  return (
    <ol className="space-y-4">
      {counts.map((c, i) => {
        const prev = i > 0 ? counts[i - 1].cantidad : null;
        const step = prev && prev > 0 ? (c.cantidad / prev) * 100 : null;
        const last = c.stage === 'cliente';
        return (
          <li key={c.stage} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3">
            <span className="num pt-px text-[11px] text-ink-muted">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-ink-primary">{STATUS_LABEL[c.stage]}</span>
                <span className="num flex shrink-0 items-baseline gap-3 text-[13px] text-ink-primary">
                  {step !== null && (
                    <span className="text-[11px] text-ink-muted">{fmtPct(step)} de la etapa anterior</span>
                  )}
                  <span>{c.cantidad}</span>
                  <span className="inline-block w-10 text-right text-[11px] text-ink-muted">{fmtPct(pct(c.cantidad, total))}</span>
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-veil/[0.07]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(c.cantidad / max) * 100}%`,
                    background: last
                      ? 'rgb(var(--c-success))'
                      : `rgb(var(--c-accent) / ${Math.max(0.35, 1 - i * 0.13)})`,
                  }}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
