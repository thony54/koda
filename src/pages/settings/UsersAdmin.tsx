import { UserCog } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';

export default function UsersAdmin() {
  return (
    <div>
      <PageHeader
        title="Usuarios"
        description="Alta, rol y activación. Solo Super Admin."
      />
      <EmptyState
        icon={<UserCog className="h-6 w-6" />}
        title="Gestión de usuarios"
        hint="El Super Admin promueve roles (lector → analista → super_admin) y activa o desactiva cuentas. Todo cambio de rol queda en la auditoría."
        phase="Fase 4"
      />
    </div>
  );
}
