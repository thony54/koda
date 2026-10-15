import React, { useEffect } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useUIStore } from '@/store/uiStore';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

/** Barra lateral + color del icono por tipo. */
const typeStyles: Record<NotificationType, { bar: string; icon: string }> = {
  success: { bar: 'bg-success', icon: 'text-success' },
  error: { bar: 'bg-danger', icon: 'text-danger' },
  warning: { bar: 'bg-warning', icon: 'text-warning' },
  info: { bar: 'bg-info', icon: 'text-info' },
};

const icons: Record<NotificationType, React.ReactNode> = {
  success: <CheckCircle2 className="h-[18px] w-[18px]" />,
  error: <XCircle className="h-[18px] w-[18px]" />,
  warning: <AlertTriangle className="h-[18px] w-[18px]" />,
  info: <Info className="h-[18px] w-[18px]" />,
};

interface ToastItemProps {
  message: string;
  type: NotificationType;
  onClose: () => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const s = typeStyles[type];

  return (
    <div
      className="glass-panel relative flex animate-slide-in-right items-center gap-3 overflow-hidden rounded-md py-3 pl-5 pr-3 shadow-pop sm:min-w-[280px] sm:max-w-sm"
      role="alert"
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${s.bar}`} aria-hidden />
      <span className={`shrink-0 ${s.icon}`}>{icons[type]}</span>
      <span className="flex-1 text-sm text-ink-primary">{message}</span>
      <button
        onClick={onClose}
        className="rounded p-1 text-ink-muted transition-colors hover:bg-veil/[0.08] hover:text-ink-primary"
        aria-label="Cerrar aviso"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

/** Contenedor global de toasts. Se monta una vez en el layout raíz. */
export const ToastHost: React.FC = () => {
  const toasts = useUIStore((s) => s.toasts);
  const dismissToast = useUIStore((s) => s.dismissToast);

  return (
    <div className="fixed bottom-5 left-4 right-4 z-[60] flex flex-col items-stretch gap-2 sm:left-auto sm:right-6 sm:items-end">
      {toasts.map((t) => (
        <ToastItem
          key={t.id}
          message={t.message}
          type={t.type}
          onClose={() => dismissToast(t.id)}
        />
      ))}
    </div>
  );
};
