import { Search } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';

export default function Jobs() {
  return (
    <div>
      <PageHeader
        title="Búsquedas"
        description="Trabajos de ingesta programados y manuales."
      />
      <EmptyState
        icon={<Search className="h-6 w-6" />}
        title="Aún no hay búsquedas configuradas"
        hint="Crea una búsqueda eligiendo fuente, consulta, ciudad, radio y horario. En v1 arrancamos con OSM/Overpass y carga manual; Google Places se agrega cuando haya presupuesto."
        phase="Fase 2"
      />
    </div>
  );
}
