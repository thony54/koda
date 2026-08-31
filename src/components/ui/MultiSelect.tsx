import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface Option {
  value: string;
  label: string;
}

interface MultiSelectProps {
  label: string;
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
}

export function MultiSelect({ label, options, value, onChange }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  const count = value.length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
          count > 0
            ? 'border-[var(--primary-orange)]/40 bg-[var(--primary-orange)]/10 text-[var(--primary-orange)]'
            : 'border-line text-ink-secondary hover:text-ink-primary'
        }`}
      >
        {label}
        {count > 0 && (
          <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[var(--primary-orange)] px-1 text-[10px] font-bold text-white">
            {count}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="glass-panel absolute left-0 top-full z-30 mt-1 max-h-64 w-52 overflow-y-auto rounded-md p-1 shadow-lg">
          {options.length === 0 && (
            <p className="px-2 py-2 text-xs text-ink-muted">Sin opciones</p>
          )}
          {options.map((opt) => {
            const checked = value.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-ink-secondary hover:bg-white/5"
              >
                <span
                  className={`grid h-4 w-4 place-items-center rounded border ${
                    checked
                      ? 'border-[var(--primary-orange)] bg-[var(--primary-orange)] text-white'
                      : 'border-line'
                  }`}
                >
                  {checked && <Check className="h-3 w-3" />}
                </span>
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
