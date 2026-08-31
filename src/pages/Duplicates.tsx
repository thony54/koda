import { Copy } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';

export default function Duplicates() {
  return (
    <div>
      <PageHeader
        title="Duplicados"
        description="Cola de posibles duplicados para revisión manual."
      />
      <EmptyState
        icon={<Copy className="h-6 w-6" />}
        title="No hay duplicados por revisar"
        hint="Cuando el normalizador detecte prospectos con nombre y ciudad muy similares (sin coincidencia exacta), los pondrá aquí para comparar lado a lado y decidir fusionar o dejar separados."
        phase="Fase 2"
      />
    </div>
  );
}
