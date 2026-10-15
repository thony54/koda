import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Mail, Lock, Radar, Gauge, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button, Input } from '@/components/ui';

const PILLARS = [
  { icon: Radar, title: 'Detecta', text: 'Busca negocios y profesionales por ciudad y rubro en mapas abiertos, Google Places o tus propios archivos.' },
  { icon: Gauge, title: 'Prioriza', text: 'Cada prospecto recibe un KODA Score que puedes explicar: ves por qué es caliente o frío.' },
  { icon: ShieldCheck, title: 'Da seguimiento', text: 'Estados, notas, mapa y avisos a Discord para que ningún contacto se enfríe.' },
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
          <span className="eyebrow">Motor de prospección</span>
        </div>

        <div className="relative flex flex-col items-center text-center">
          <img
            src="/logo.png"
            alt="KODA"
            className="h-56 w-56 select-none object-contain [filter:drop-shadow(0_0_36px_rgb(var(--c-accent)/0.35))]"
            draggable={false}
          />
          <h2 className="mt-8 max-w-md text-balance font-heading text-[34px] font-semibold leading-tight text-ink-primary">
            Tus próximos clientes, ya identificados.
          </h2>
          <p className="mt-4 max-w-md text-balance text-[15px] leading-relaxed text-ink-secondary">
            KODA rastrea negocios y profesionales en las ciudades que elijas, los califica con un
            puntaje claro y te muestra a quién contactar primero. Menos búsqueda manual, más
            conversaciones que valen la pena.
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
      <main className="relative flex min-h-screen flex-col px-5">
        <div className="grid flex-1 place-items-center py-12">
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
            <p className="mt-2 max-w-[280px] text-balance text-xs leading-relaxed text-ink-muted">
              Encuentra, puntúa y prioriza a tus próximos clientes.
            </p>
          </div>

          <p className="eyebrow mb-2 hidden text-accent-text/80 lg:block">Acceso</p>
          <h1 className="font-heading text-[28px] font-semibold leading-tight text-ink-primary">
            Inicia sesión
          </h1>

          <form onSubmit={onSubmit} className="glass-panel panel-ember mt-6 space-y-4 rounded-lg p-6">
            <Input
              id="email"
              type="email"
              label="Correo"
              autoComplete="email"
              required
              icon={<Mail className="h-4 w-4" />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
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

        </div>
        </div>

        {/* Crédito */}
        <footer className="flex items-center justify-center gap-2 pb-6 pt-2 text-[11px] text-ink-muted">
          <span className="h-px w-6 bg-line-strong" aria-hidden />
          <span>Creado por</span>
          <span className="font-heading font-semibold uppercase tracking-[0.16em] text-ink-secondary">Quantum Code</span>
          <span className="h-px w-6 bg-line-strong" aria-hidden />
        </footer>
      </main>
    </div>
  );
}
