import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Mail, Lock, Radar, Gauge, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button, Input } from '@/components/ui';

const PILLARS = [
  { icon: Radar, title: 'Detección', text: 'Encuentra negocios sin presencia digital en tus ciudades objetivo.' },
  { icon: Gauge, title: 'KODA Score', text: 'Cada prospecto con un puntaje explicable, nunca una caja negra.' },
  { icon: ShieldCheck, title: 'Control', text: 'Datos aislados por usuario y auditoría de cada cambio.' },
];

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
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Panel de marca (solo escritorio) */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-surface-base/60 p-12 lg:flex">
        {/* Resplandor de brasa detrás del logo */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[36%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background:
              'radial-gradient(closest-side, rgb(var(--c-accent) / 0.22), rgb(var(--c-accent) / 0.05) 55%, transparent 75%)',
          }}
        />

        <div className="relative flex items-center gap-3">
          <span className="font-heading text-lg font-semibold tracking-[0.25em] text-ink-primary">KODA</span>
          <span className="h-4 w-px bg-line-strong" />
          <span className="eyebrow">Connexo</span>
        </div>

        <div className="relative flex flex-col items-center text-center">
          <img
            src="/logo.png"
            alt="KODA"
            className="h-56 w-56 select-none object-contain [filter:drop-shadow(0_0_36px_rgb(var(--c-accent)/0.35))]"
            draggable={false}
          />
          <h2 className="mt-8 font-heading text-[34px] font-semibold leading-tight text-ink-primary">
            Prospección con criterio.
          </h2>
          <p className="mt-3 max-w-md text-[15px] text-ink-secondary">
            El motor que encuentra, puntúa y prioriza a los clientes de Connexo antes de que lo haga la competencia.
          </p>
        </div>

        <ul className="relative grid grid-cols-3 gap-6 border-t border-line pt-8">
          {PILLARS.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <Icon className="h-4 w-4 text-accent-text" strokeWidth={1.75} />
              <p className="mt-3 text-[13px] font-semibold text-ink-primary">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{text}</p>
            </li>
          ))}
        </ul>
      </aside>

      {/* Formulario */}
      <main className="relative grid place-items-center px-5 py-12">
        <div className="w-full max-w-[380px]">
          {/* Marca compacta (móvil) */}
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <img
              src="/logo.png"
              alt="KODA"
              className="h-20 w-20 select-none object-contain [filter:drop-shadow(0_0_20px_rgb(var(--c-accent)/0.4))]"
              draggable={false}
            />
            <p className="mt-3 font-heading text-xl font-semibold tracking-[0.25em] text-ink-primary">KODA</p>
          </div>

          <p className="eyebrow mb-2 hidden text-accent-text/80 lg:block">Acceso</p>
          <h1 className="font-heading text-[28px] font-semibold leading-tight text-ink-primary">
            Inicia sesión
          </h1>
          <p className="mt-1.5 text-sm text-ink-secondary">
            Usa la cuenta que te habilitó un Super Admin.
          </p>

          <form onSubmit={onSubmit} className="glass-panel panel-ember mt-7 space-y-4 rounded-lg p-6">
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
              <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            <Button type="submit" size="lg" loading={submitting} className="w-full">
              Entrar
            </Button>

            {notConfigured && (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                Supabase no está configurado. Crea <code>.env.local</code> con
                <code> VITE_SUPABASE_URL</code> y <code> VITE_SUPABASE_ANON_KEY</code>.
              </p>
            )}
          </form>

          <p className="mt-5 text-center text-xs text-ink-muted">
            No hay registro público. El acceso lo gestiona el Super Admin.
          </p>
        </div>
      </main>
    </div>
  );
}
