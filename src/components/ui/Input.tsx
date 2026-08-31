import React from 'react';

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
      <label htmlFor={id} className="block text-sm font-medium text-ink-secondary">
        {label}
      </label>
    )}
    <div className="relative">
      {icon && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
          {icon}
        </div>
      )}
      <input
        id={id}
        className={`glass-input w-full rounded-md px-3 py-2.5 text-ink-primary font-sans placeholder:text-ink-muted min-h-[40px] outline-none ${
          icon ? 'pl-10' : ''
        } ${error ? 'border-red-500 focus:border-red-500' : ''} ${className}`}
        {...props}
      />
    </div>
    {error && <p className="text-xs text-red-500">{error}</p>}
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
      <label htmlFor={id} className="block text-sm font-medium text-ink-secondary">
        {label}
      </label>
    )}
    <textarea
      id={id}
      className={`glass-input w-full rounded-md px-3 py-2.5 text-ink-primary font-sans placeholder:text-ink-muted resize-vertical min-h-[100px] outline-none ${
        error ? 'border-red-500' : ''
      } ${className}`}
      {...props}
    />
    {error && <p className="text-xs text-red-500">{error}</p>}
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
      <label htmlFor={id} className="block text-sm font-medium text-ink-secondary">
        {label}
      </label>
    )}
    <select
      id={id}
      className={`glass-input w-full rounded-md px-3 py-2.5 text-ink-primary font-sans min-h-[40px] outline-none appearance-none cursor-pointer ${
        error ? 'border-red-500' : ''
      } ${className}`}
      {...props}
    >
      {children}
    </select>
    {error && <p className="text-xs text-red-500">{error}</p>}
  </div>
);
