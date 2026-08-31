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
    sm: 'px-3 py-1.5 text-xs min-h-[36px]',
    md: 'px-4 py-2 text-sm min-h-[40px]',
    lg: 'px-6 py-3 text-base min-h-[48px]',
  };

  const variantClasses = {
    primary: 'glass-button text-white font-bold border border-transparent',
    secondary:
      'bg-transparent border border-[var(--primary-orange)] text-[var(--primary-orange)] hover:bg-[var(--primary-orange)]/10',
    ghost: 'text-ink-secondary hover:text-ink-primary hover:bg-white/5',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-500/20',
  };

  const base =
    'inline-flex items-center justify-center gap-2 font-medium font-sans rounded-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--background-dark)] focus:ring-[var(--primary-orange)] disabled:opacity-50 disabled:cursor-not-allowed active:scale-95';

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
