import React from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Etiqueta pequeña en monoespaciada sobre el título (contexto de la pantalla). */
  eyebrow?: string;
}

export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2 text-accent-text/80">{eyebrow}</p>}
        <h1 className="font-heading text-[26px] font-semibold leading-tight text-ink-primary sm:text-[30px]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm text-ink-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
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
 */
export function EmptyState({ icon, title, hint, action, phase }: EmptyStateProps) {
  return (
    <div className="glass-panel rounded-lg px-6 py-14 text-center">
      {icon && (
        <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-lg border border-line-strong bg-surface-elevated text-ink-muted">
          {icon}
        </div>
      )}
      <h2 className="font-heading text-lg font-semibold text-ink-primary">{title}</h2>
      {hint && <p className="mx-auto mt-2 max-w-md text-sm text-ink-secondary">{hint}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
      {phase && (
        <p className="eyebrow mt-8">Se implementa en {phase}</p>
      )}
    </div>
  );
}
