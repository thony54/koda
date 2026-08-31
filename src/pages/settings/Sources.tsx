import { Database } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';

export default function Sources() {
  return (
    <div>
      <PageHeader
        title="Fuentes"
        description="Fuentes de datos, límites y claves de API."
      />
      <EmptyState
        icon={<Database className="h-6 w-6" />}
        title="CRUD de fuentes"
        hint="Configura OSM/Overpass, CSV y (más adelante) Google Places. Las claves de API son de solo escritura: se guardan pero nunca se muestran."
        phase="Fase 2"
      />
    </div>
  );
}
