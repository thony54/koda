import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';
import { Badge, Table, THead, TBody, TR, TH, TD } from '@/components/ui';
import { useJobRuns } from '@/hooks/useJobs';
import { formatDateTime, formatUSD } from '@/lib/format';

const statusVariant: Record<string, 'success' | 'warning' | 'error' | 'default' | 'info'> = {
  ok: 'success', corriendo: 'info', pendiente: 'default', error: 'error', cancelado: 'warning',
};

function duration(a: string, b: string | null): string {
  if (!b) return '—';
  const s = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function JobRuns() {
  const { id } = useParams();
  const { data, isLoading } = useJobRuns(id);

  return (
    <div>
      <Link to="/busquedas" className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-ink-primary">
        <ArrowLeft className="h-4 w-4" /> Búsquedas
      </Link>
      <PageHeader title="Historial de ejecuciones" description={data?.jobNombre ?? undefined} />

      {isLoading ? (
        <div className="grid place-items-center py-20 text-ink-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (data?.runs ?? []).length === 0 ? (
        <EmptyState
          title="Sin ejecuciones todavía"
          hint="Cada corrida aparecerá aquí con encontrados, nuevos, duplicados, duración, costo y errores. Las corridas las genera el collector (Fase 2)."
        />
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Inicio</TH><TH>Estado</TH><TH className="text-right">Encontrados</TH><TH className="text-right">Nuevos</TH><TH className="text-right">Duplicados</TH><TH>Duración</TH><TH className="text-right">Costo</TH>
            </TR>
          </THead>
          <TBody>
            {(data?.runs ?? []).map((r) => (
              <TR key={r.id}>
                <TD className="text-xs text-ink-secondary">{formatDateTime(r.started_at)}</TD>
                <TD><Badge variant={statusVariant[r.status] ?? 'default'}>{r.status}</Badge></TD>
                <TD className="text-right text-ink-secondary">{r.encontrados}</TD>
                <TD className="text-right text-emerald-400">{r.nuevos}</TD>
                <TD className="text-right text-ink-muted">{r.duplicados}</TD>
                <TD className="text-ink-secondary">{duration(r.started_at, r.finished_at)}</TD>
                <TD className="text-right text-ink-secondary">{formatUSD(r.costo_estimado)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
