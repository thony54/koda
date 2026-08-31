import { ShieldCheck } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';

export default function Privacy() {
  return (
    <div>
      <PageHeader
        title="Privacidad (LOPDP)"
        description="Lista de supresión, retención y trazabilidad de origen de datos."
      />
      <EmptyState
        icon={<ShieldCheck className="h-6 w-6" />}
        title="Cumplimiento por diseño"
        hint="Aquí se gestiona el derecho de supresión (eliminar y bloquear), la retención automática de descartados y la exportación del registro de origen de cada dato."
        phase="Fase 4"
      />
    </div>
  );
}
