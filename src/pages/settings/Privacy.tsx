import { Loader2, ShieldCheck, Clock, FileDown, Ban } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, Table, THead, TBody, TR, TH, TD } from '@/components/ui';
import { useDeletionRequests } from '@/hooks/useAdmin';
import { formatDateTime } from '@/lib/format';

export default function Privacy() {
  const { data: requests, isLoading } = useDeletionRequests();

  return (
    <div>
      <PageHeader
        title="Privacidad (LOPDP)"
        description="Lista de supresión, retención y trazabilidad de origen de datos."
      />

      {/* Principios */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <Ban className="mb-2 h-5 w-5 text-[var(--primary-orange)]" />
          <h3 className="font-heading text-ink-primary">Derecho de supresión</h3>
          <p className="mt-1 text-sm text-ink-secondary">
            "Eliminar y bloquear" borra el prospecto y guarda su hash para que ningún
            crawler lo vuelva a ingresar.
          </p>
        </Card>
        <Card>
          <Clock className="mb-2 h-5 w-5 text-[var(--primary-orange)]" />
          <h3 className="font-heading text-ink-primary">Retención</h3>
          <p className="mt-1 text-sm text-ink-secondary">
            Los prospectos <code>descartado</code> se eliminan a los 12 meses (job
            <code> koda-retention</code>, Fase 4).
          </p>
        </Card>
        <Card>
          <FileDown className="mb-2 h-5 w-5 text-[var(--primary-orange)]" />
          <h3 className="font-heading text-ink-primary">Trazabilidad</h3>
          <p className="mt-1 text-sm text-ink-secondary">
            Cada prospecto guarda su fuente y URL de origen. Si alguien pregunta de
            dónde salió su dato, la respuesta está en la base.
          </p>
        </Card>
      </div>

      <Card padding="none">
        <div className="border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 font-heading text-lg text-ink-primary">
            <ShieldCheck className="h-4 w-4" /> Lista de supresión
          </h2>
        </div>
        {isLoading ? (
          <div className="grid place-items-center py-16 text-ink-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (requests ?? []).length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-muted">
            No hay solicitudes de supresión. Cuando elimines un prospecto con "Eliminar y
            bloquear", su hash aparecerá aquí y quedará vetado para futuras ingestas.
          </p>
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent"><TH>Hash</TH><TH>Motivo</TH><TH>Solicitado por</TH><TH>Fecha</TH></TR>
            </THead>
            <TBody>
              {(requests ?? []).map((r) => (
                <TR key={r.id}>
                  <TD><code className="text-xs text-ink-muted">{r.prospect_hash.slice(0, 16)}…</code></TD>
                  <TD className="text-ink-secondary">{r.motivo ?? '—'}</TD>
                  <TD className="text-ink-secondary">{r.solicitado_por ?? '—'}</TD>
                  <TD className="text-xs text-ink-muted">{formatDateTime(r.created_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
