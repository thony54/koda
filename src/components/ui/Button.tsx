import React from 'react';
import { Spinner } from './Spinner';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: React.ReactNode;
  /** Pinta el estilo sobre el hijo (típicamente un <a>) en vez de anidarlo. */
  asChild?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  disabled,
  asChild = false,
  ...props
}) => {
  const sizeClasses = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-9 px-4 text-[13px]',
    lg: 'h-11 px-6 text-sm',
  };

  const variantClasses = {
    primary: 'glass-button font-semibold',
    secondary:
      'border border-line-strong bg-surface-elevated/60 text-ink-primary hover:bg-surface-elevated hover:border-accent/45',
    ghost: 'text-ink-secondary hover:text-ink-primary hover:bg-veil/[0.06]',
    danger:
      'border border-danger/35 bg-danger/10 text-danger hover:bg-danger/20 hover:border-danger/55',
  };

  const base =
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium font-sans rounded-md transition-[background-color,border-color,color,box-shadow,filter] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-void disabled:opacity-50 disabled:cursor-not-allowed';

  const composed = `${base} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`;

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ className?: string }>;
    return React.cloneElement(child, {
      className: `${composed} ${child.props.className ?? ''}`.trim(),
    });
  }

  return (
    <button className={composed} disabled={disabled || loading} {...props}>
      {loading && <Spinner />}
      {children}
    </button>
  );
};
