import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary';
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'sm',
  className = '',
}) => {
  const variantClasses = {
    default: 'bg-veil/[0.06] text-ink-secondary border-line',
    primary: 'bg-accent/10 text-accent-text border-accent/25',
    success: 'bg-success/10 text-success border-success/25',
    warning: 'bg-warning/10 text-warning border-warning/25',
    error: 'bg-danger/10 text-danger border-danger/25',
    info: 'bg-info/10 text-info border-info/25',
  };

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[11px]',
    md: 'px-2.5 py-1 text-xs',
  };

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap font-medium rounded-sm border ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {children}
    </span>
  );
};
