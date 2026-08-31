import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Mail, Lock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button, Input } from '@/components/ui';

export default function Login() {
  const { loading, session, isAuthorized, notConfigured, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Con sesión ya resuelta salimos del login: si está autorizado, al destino;
  // si no (perfil inactivo/inexistente), el ProtectedRoute mostrará el motivo.
  if (!loading && session) {
    const from = (location.state as { from?: { pathname: string } })?.from?.pathname;
    return <Navigate to={isAuthorized ? from ?? '/' : '/'} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await signIn(email.trim(), password);
    setSubmitting(false);
    if (error) {
      setError(
        error.toLowerCase().includes('invalid')
          ? 'Correo o contraseña incorrectos.'
          : error,
      );
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-surface-base px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-lg bg-[var(--primary-orange)] font-heading text-xl font-bold text-white">
            K
          </span>
          <h1 className="font-heading text-2xl font-semibold text-ink-primary">KODA</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Motor de prospectos · Connexo
          </p>
        </div>

        <form onSubmit={onSubmit} className="glass-panel rounded-lg p-6 space-y-4">
          <Input
            id="email"
            type="email"
            label="Correo"
            autoComplete="email"
            required
            icon={<Mail className="h-4 w-4" />}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@connexoapp.com"
          />
          <Input
            id="password"
            type="password"
            label="Contraseña"
            autoComplete="current-password"
            required
            icon={<Lock className="h-4 w-4" />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />

          {error && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          <Button type="submit" loading={submitting} className="w-full">
            Entrar
          </Button>

          {notConfigured && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
              Supabase no está configurado. Crea <code>.env.local</code> con
              <code> VITE_SUPABASE_URL</code> y <code> VITE_SUPABASE_ANON_KEY</code>.
            </p>
          )}
        </form>

        <p className="mt-4 text-center text-xs text-ink-muted">
          El acceso lo habilita un Super Admin. No hay registro público.
        </p>
      </div>
    </div>
  );
}
