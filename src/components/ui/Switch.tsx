interface SwitchProps {
  checked: boolean;
  onChange: () => void;
  label?: string;
  disabled?: boolean;
}

/** Interruptor de encendido/apagado. Encendido = relleno de acento con brillo tenue. */
export function Switch({ checked, onChange, label = 'Activar/desactivar', disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? 'border-accent bg-accent shadow-[0_0_12px_-2px_rgb(var(--c-accent)/0.6)]'
          : 'border-line-strong bg-surface-elevated'
      }`}
    >
      <span
        className={`absolute top-[2px] h-3.5 w-3.5 rounded-full transition-all duration-150 ${
          checked ? 'left-[18px] bg-accent-on' : 'left-[2px] bg-ink-muted'
        }`}
      />
    </button>
  );
}
