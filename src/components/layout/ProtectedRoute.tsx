import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Spinner } from '@/components/ui';

/**
 * Bloquea toda la app tras login. Verifica sesión + profiles.activo
 * (sección 9). Un usuario con sesión pero inactivo NO entra.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { loading, session, profile, isAuthorized } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-surface-base text-ink-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (isAuthorized) {
    return <>{children}</>;
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Sesión válida pero perfil inactivo o inexistente: sin acceso.
  return (
    <div className="min-h-screen grid place-items-center bg-surface-base px-4">
      <div className="glass-panel max-w-md rounded-lg p-8 text-center space-y-3">
        <h1 className="font-heading text-xl text-ink-primary">Cuenta sin acceso</h1>
        <p className="text-sm text-ink-secondary">
          {profile
            ? 'Tu cuenta está desactivada. Pide a un Super Admin que la habilite.'
            : 'Tu usuario aún no tiene un perfil asignado en KODA.'}
        </p>
        <SignOutLink />
      </div>
    </div>
  );
}

function SignOutLink() {
  const { signOut } = useAuth();
  return (
    <button
      onClick={() => void signOut()}
      className="text-sm text-[var(--primary-orange)] hover:underline"
    >
      Cerrar sesión
    </button>
  );
}
