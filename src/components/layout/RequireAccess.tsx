import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { EmptyState } from './PageHeader';
import { useAuth } from '@/hooks/useAuth';
import { canAccess, type AccessRule } from '@/lib/permissions';

/**
 * Protege una pantalla por rol y/o función habilitada. Es una barrera de
 * interfaz: la seguridad real la aplican RLS y las Edge Functions.
 */
export function RequireAccess({ children, ...rule }: AccessRule & { children: ReactNode }) {
  const { profile } = useAuth();
  if (canAccess(profile, rule)) return <>{children}</>;
  return (
    <EmptyState
      icon={<Lock className="h-6 w-6" />}
      title="No tienes acceso a esta función"
      hint="Tu usuario no la tiene habilitada. Si la necesitas, pídesela al administrador de KODA."
    />
  );
}
