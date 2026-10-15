import { useState } from 'react';
import { X } from 'lucide-react';

interface TagInputProps {
  label?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** 'danger' pinta las etiquetas en rojo (cosas que se quieren evitar). */
  tone?: 'accent' | 'danger';
  max?: number;
  /** Largo mínimo de cada etiqueta (las palabras muy cortas hacen coincidencias falsas). */
  minLength?: number;
}

/** Entrada de etiquetas libres: se agregan con Enter o coma, se quitan con la ×. */
export function TagInput({ label, value, onChange, placeholder, tone = 'accent', max = 30, minLength = 1 }: TagInputProps) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const nuevas = raw.split(',').map((t) => t.trim()).filter((t) => t.length >= minLength);
    if (!nuevas.length) return;
    const existentes = new Set(value.map((v) => v.toLowerCase()));
    const merged = [...value];
    for (const t of nuevas) {
      if (merged.length >= max) break;
      if (!existentes.has(t.toLowerCase())) { merged.push(t); existentes.add(t.toLowerCase()); }
    }
    onChange(merged);
    setDraft('');
  };

  const chip = tone === 'danger'
    ? 'border-danger/30 bg-danger/10 text-danger'
    : 'border-accent/30 bg-accent/10 text-accent-text';

  return (
    <div className="w-full space-y-1.5">
      {label && <span className="block text-xs font-medium text-ink-secondary">{label}</span>}
      <div className="glass-input flex min-h-10 flex-wrap items-center gap-1.5 rounded-md px-2.5 py-1.5">
        {value.map((t) => (
          <span key={t} className={`inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1.5 text-xs ${chip}`}>
            {t}
            <button
              type="button"
              aria-label={`Quitar ${t}`}
              onClick={() => onChange(value.filter((x) => x !== t))}
              className="rounded-full p-0.5 opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {value.length < max && (
          <input
            value={draft}
            onChange={(e) => {
              const v = e.target.value;
              if (v.includes(',')) add(v); else setDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); add(draft); }
              else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
            }}
            onBlur={() => add(draft)}
            placeholder={value.length ? '' : placeholder}
            className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm text-ink-primary outline-none placeholder:text-ink-muted"
          />
        )}
      </div>
    </div>
  );
}
