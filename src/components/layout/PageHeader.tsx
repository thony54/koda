import React from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-ink-primary">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-ink-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  /** Etiqueta de la fase en la que se implementa esta pantalla. */
  phase?: string;
}

/**
 * Estado vacío honesto: dice qué hacer, no se disculpa (sección 10.2).
 * En Fase 0 casi todas las pantallas son este placeholder.
 */
export function EmptyState({ icon, title, hint, action, phase }: EmptyStateProps) {
  return (
    <div className="glass-panel rounded-lg p-10 text-center">
      {icon && (
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-surface-elevated text-ink-muted">
          {icon}
        </div>
      )}
      <h2 className="font-heading text-lg text-ink-primary">{title}</h2>
      {hint && <p className="mx-auto mt-2 max-w-md text-sm text-ink-secondary">{hint}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
      {phase && (
        <p className="mt-6 text-[11px] uppercase tracking-wider text-ink-muted">
          Se implementa en {phase}
        </p>
      )}
    </div>
  );
}
