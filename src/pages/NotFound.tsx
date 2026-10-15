import { Link } from 'react-router-dom';
import { Button } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <div className="space-y-3">
        <p className="num text-[72px] font-semibold leading-none text-accent-text [text-shadow:0_0_40px_rgb(var(--c-accent)/0.45)]">404</p>
        <h1 className="font-heading text-xl font-semibold text-ink-primary">Ruta no encontrada</h1>
        <p className="text-sm text-ink-secondary">
          Esta pantalla no existe o todavía no está construida.
        </p>
        <Button asChild>
          <Link to="/">Volver al inicio</Link>
        </Button>
      </div>
    </div>
  );
}
