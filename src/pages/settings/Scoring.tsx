import { SlidersHorizontal } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';

export default function Scoring() {
  return (
    <div>
      <PageHeader
        title="Reglas de scoring"
        description="Las reglas del KODA Score viven en la base, no en el código."
      />
      <EmptyState
        icon={<SlidersHorizontal className="h-6 w-6" />}
        title="CRUD de reglas + simulador"
        hint="Aquí el equipo comercial ajustará los puntos de cada señal y verá en un simulador cómo quedaría el top 20 con esas reglas, sin desplegar."
        phase="Fase 3"
      />
    </div>
  );
}
