import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';

export default function JobRuns() {
  const { id } = useParams();
  return (
    <div>
      <Link
        to="/busquedas"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-ink-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Búsquedas
      </Link>
      <PageHeader title="Historial de ejecuciones" description={`Búsqueda: ${id}`} />
      <EmptyState
        title="Sin ejecuciones todavía"
        hint="Aquí aparecerá cada corrida con encontrados, nuevos, duplicados, duración, costo estimado y errores."
        phase="Fase 2"
      />
    </div>
  );
}
