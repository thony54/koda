import { Loader2, Download } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';
import { Card, Button } from '@/components/ui';
import { useReportData } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { STATUS_LABEL } from '@/components/prospects/Filters';
import type { ReportBucket } from '@/lib/data/admin';
import type { ProspectStatus } from '@/types/domain';
import { CHART_ACCENT, CHART_PEACH, axisTick, categoryTick, gridStroke, tooltipProps } from '@/lib/chartTheme';

function BarCard({ title, data, color = CHART_ACCENT }: { title: string; data: ReportBucket[]; color?: string }) {
  return (
    <Card>
      <h2 className="mb-4 card-title">{title}</h2>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="2 4" stroke={gridStroke} horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" width={110} tick={categoryTick} axisLine={false} tickLine={false} />
            <Tooltip {...tooltipProps} />
            <Bar dataKey="cantidad" fill={color} radius={[0, 3, 3, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function exportReport(data: { total: number; porCiudad: ReportBucket[]; porRubro: ReportBucket[]; porFuente: ReportBucket[]; porStatus: ReportBucket[] }) {
  const lines = ['seccion,etiqueta,cantidad'];
  const push = (sec: string, buckets: ReportBucket[]) => buckets.forEach((b) => lines.push(`${sec},"${b.label}",${b.cantidad}`));
  push('ciudad', data.porCiudad); push('rubro', data.porRubro); push('fuente', data.porFuente); push('status', data.porStatus);
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
      <div><PageHeader title="Reportes" />
        <div className="grid place-items-center py-20 text-ink-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>
      </div>
    );
  }

  if (!data || data.total === 0) {
    return (
      <div>
        <PageHeader title="Reportes" description="Por ciudad, rubro, fuente, embudo por estado y evolución mensual." />
        <EmptyState title="Sin datos para reportar" hint="Los reportes se llenan a medida que entran prospectos. Importá un CSV para empezar." />
      </div>
    );
  }

  const funnel = data.porStatus.map((b) => ({ ...b, label: STATUS_LABEL[b.label as ProspectStatus] ?? b.label }));

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
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <BarCard title="Por ciudad" data={data.porCiudad} />
        <BarCard title="Por rubro" data={data.porRubro} color={CHART_PEACH} />
        <Card>
          <h2 className="mb-4 card-title">Embudo por estado</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnel} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="2 4" stroke={gridStroke} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" width={90} tick={categoryTick} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipProps} />
                <Bar dataKey="cantidad" radius={[0, 3, 3, 0]} maxBarSize={18}>
                  {funnel.map((_, i) => <Cell key={i} fill={CHART_ACCENT} fillOpacity={Math.max(0.35, 1 - i * 0.1)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <BarCard title="Por fuente" data={data.porFuente} color="#b3754d" />
      </div>
    </div>
  );
}
