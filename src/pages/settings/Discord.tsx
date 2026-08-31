import { MessageSquare } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';

export default function Discord() {
  return (
    <div>
      <PageHeader
        title="Discord"
        description="Canales, webhooks y umbral de score para notificar."
      />
      <EmptyState
        icon={<MessageSquare className="h-6 w-6" />}
        title="Configuración de notificaciones"
        hint="Aquí van los webhooks (enmascarados), el umbral de score y un botón 'Enviar prueba'. Las URLs de webhook son secretos: viven en Supabase, nunca en el frontend."
        phase="Fase 3"
      />
    </div>
  );
}
