import { Map as MapIcon } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';

export default function MapPage() {
  return (
    <div>
      <PageHeader
        title="Mapa"
        description="Prospectos geolocalizados, color por banda de score."
      />
      <EmptyState
        icon={<MapIcon className="h-6 w-6" />}
        title="Nada que mapear todavía"
        hint="Cuando los prospectos tengan coordenadas, verás aquí el mapa con marcadores por banda de score y filtro por ciudad."
        phase="Fase 4"
      />
    </div>
  );
}
