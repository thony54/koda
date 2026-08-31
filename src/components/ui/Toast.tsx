import React, { useEffect } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useUIStore } from '@/store/uiStore';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

const typeStyles: Record<NotificationType, string> = {
  success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
  error: 'bg-red-500/10 border-red-500/30 text-red-400',
  warning: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
  info: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
};

const icons: Record<NotificationType, React.ReactNode> = {
  success: <CheckCircle2 className="w-5 h-5" />,
  error: <XCircle className="w-5 h-5" />,
  warning: <AlertTriangle className="w-5 h-5" />,
  info: <Info className="w-5 h-5" />,
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

  return (
    <div
      className={`px-4 py-3 rounded-md border backdrop-blur-sm shadow-lg animate-slide-in-right flex items-center gap-3 ${typeStyles[type]}`}
      role="alert"
    >
      {icons[type]}
      <span className="font-medium text-sm text-ink-primary">{message}</span>
      <button
        onClick={onClose}
        className="ml-2 p-1 hover:bg-white/10 rounded transition-colors"
        aria-label="Cerrar aviso"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

/** Contenedor global de toasts. Se monta una vez en el layout raíz. */
export const ToastHost: React.FC = () => {
  const toasts = useUIStore((s) => s.toasts);
  const dismissToast = useUIStore((s) => s.dismissToast);

  return (
    <div className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2">
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
