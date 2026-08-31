import { Loader2, ScrollText } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';
import { Badge, Table, THead, TBody, TR, TH, TD } from '@/components/ui';
import { useAuditLog } from '@/hooks/useAdmin';
import { formatDateTime } from '@/lib/format';

export default function Logs() {
  const { data: entries, isLoading } = useAuditLog();

  return (
    <div>
      <PageHeader
        title="Auditoría"
        description="Registro de cambios de rol, borrados y ediciones de reglas."
      />

      {isLoading ? (
        <div className="grid place-items-center py-20 text-ink-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (entries ?? []).length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-6 w-6" />}
          title="El registro está vacío"
          hint="Cada acción sensible (cambio de rol, borrado de prospecto, edición de scoring) quedará aquí. La escritura del audit_log se conecta con triggers en la Fase 4."
        />
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent"><TH>Acción</TH><TH>Entidad</TH><TH>Actor</TH><TH>Fecha</TH></TR>
          </THead>
          <TBody>
            {(entries ?? []).map((e) => (
              <TR key={e.id}>
                <TD><Badge variant="info">{e.accion}</Badge></TD>
                <TD className="text-ink-secondary">{e.entidad ?? '—'}</TD>
                <TD className="text-xs text-ink-muted">{e.actor_id?.slice(0, 8) ?? 'sistema'}</TD>
                <TD className="text-xs text-ink-muted">{formatDateTime(e.created_at)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
