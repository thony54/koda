import React from 'react';

const labelCls = 'block text-xs font-medium text-ink-secondary';
const errorCls = 'text-xs text-danger';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  icon,
  id,
  className = '',
  ...props
}) => (
  <div className="w-full space-y-1.5">
    {label && (
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
    )}
    <div className="relative">
      {icon && (
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
          {icon}
        </div>
      )}
      <input
        id={id}
        className={`glass-input h-10 w-full rounded-md px-3 text-sm text-ink-primary font-sans placeholder:text-ink-muted outline-none ${
          icon ? 'pl-10' : ''
        } ${error ? '!border-danger/70' : ''} ${className}`}
        {...props}
      />
    </div>
    {error && <p className={errorCls}>{error}</p>}
  </div>
);

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea: React.FC<TextareaProps> = ({
  label,
  error,
  id,
  className = '',
  ...props
}) => (
  <div className="w-full space-y-1.5">
    {label && (
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
    )}
    <textarea
      id={id}
      className={`glass-input min-h-[100px] w-full resize-y rounded-md px-3 py-2.5 text-sm text-ink-primary font-sans placeholder:text-ink-muted outline-none ${
        error ? '!border-danger/70' : ''
      } ${className}`}
      {...props}
    />
    {error && <p className={errorCls}>{error}</p>}
  </div>
);

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  children: React.ReactNode;
}

export const Select: React.FC<SelectProps> = ({
  label,
  error,
  id,
  children,
  className = '',
  ...props
}) => (
  <div className="w-full space-y-1.5">
    {label && (
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
    )}
    <select
      id={id}
      className={`glass-input h-10 w-full cursor-pointer appearance-none rounded-md px-3 text-sm text-ink-primary font-sans outline-none ${
        error ? '!border-danger/70' : ''
      } ${className}`}
      {...props}
    >
      {children}
    </select>
    {error && <p className={errorCls}>{error}</p>}
  </div>
);
