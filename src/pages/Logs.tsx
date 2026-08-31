import { ScrollText } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';

export default function Logs() {
  return (
    <div>
      <PageHeader
        title="Auditoría"
        description="Registro de cambios de rol, borrados y ediciones de reglas."
      />
      <EmptyState
        icon={<ScrollText className="h-6 w-6" />}
        title="El registro está vacío"
        hint="Cada acción sensible (cambio de rol, borrado de prospecto, edición de scoring) quedará aquí, filtrable por actor, entidad y fecha."
        phase="Fase 4"
      />
    </div>
  );
}
