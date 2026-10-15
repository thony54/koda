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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
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
        aria-expanded={open}
        className={`flex h-9 items-center gap-1.5 rounded-md border px-3 text-[13px] transition-colors ${
          count > 0
            ? 'border-accent/45 bg-accent/10 text-accent-text'
            : 'border-line-strong bg-surface-inset text-ink-secondary hover:border-[rgb(var(--c-ink)/0.28)] hover:text-ink-primary'
        }`}
      >
        {label}
        {count > 0 && (
          <span className="num grid h-4 min-w-4 place-items-center rounded-sm bg-accent px-1 text-[10px] font-semibold text-accent-on">
            {count}
          </span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 opacity-70 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="glass-panel absolute left-0 top-full z-30 mt-1.5 max-h-64 w-56 animate-fade-in overflow-y-auto rounded-md p-1 shadow-pop">
          {options.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-ink-muted">Sin opciones</p>
          )}
          {options.map((opt) => {
            const checked = value.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className={`flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-veil/[0.06] ${
                  checked ? 'text-ink-primary' : 'text-ink-secondary'
                }`}
              >
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border transition-colors ${
                    checked
                      ? 'border-accent bg-accent text-accent-on'
                      : 'border-line-strong bg-surface-inset'
                  }`}
                >
                  {checked && <Check className="h-3 w-3" strokeWidth={3} />}
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
