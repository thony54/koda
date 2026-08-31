import { Link } from 'react-router-dom';
import { Button } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="grid place-items-center py-20 text-center">
      <div className="space-y-3">
        <p className="font-heading text-5xl font-bold text-[var(--primary-orange)]">404</p>
        <h1 className="font-heading text-xl text-ink-primary">Ruta no encontrada</h1>
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
