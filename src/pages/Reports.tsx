import { BarChart3 } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';

export default function Reports() {
  return (
    <div>
      <PageHeader
        title="Reportes"
        description="Por ciudad, rubro, fuente, embudo por estado y evolución mensual."
      />
      <EmptyState
        icon={<BarChart3 className="h-6 w-6" />}
        title="Sin datos para reportar"
        hint="Los reportes se llenan a medida que entran prospectos y jobs. Podrás exportar cada corte."
        phase="Fase 4"
      />
    </div>
  );
}
