import { PERMISSIONS, PERMISSION_PRESETS, type PermissionKey } from '@/lib/permissions';

interface PermissionPickerProps {
  value: PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
  /** Bloqueado (p. ej. el Super Admin ya tiene todas las funciones). */
  disabled?: boolean;
}

const GROUPS = [...new Set(PERMISSIONS.map((p) => p.group))];

/** Casillas de funciones agrupadas, con atajos para los perfiles más comunes. */
export function PermissionPicker({ value, onChange, disabled }: PermissionPickerProps) {
  const selected = new Set(value);

  function toggle(key: PermissionKey) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange([...next]);
  }

  const googleSinBusquedas = selected.has('google_places') && !selected.has('busquedas');

  return (
    <div className="space-y-3">
      {!disabled && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-muted">Atajos:</span>
          {PERMISSION_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.hint}
              onClick={() => onChange(p.permisos)}
              className="rounded-full border border-line px-3 py-1 text-xs text-ink-secondary transition-colors hover:border-[var(--primary-orange)] hover:text-ink-primary"
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded-full border border-line px-3 py-1 text-xs text-ink-muted transition-colors hover:text-ink-primary"
          >
            Ninguna
          </button>
        </div>
      )}

      {GROUPS.map((group) => (
        <div key={group}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{group}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {PERMISSIONS.filter((p) => p.group === group).map((p) => {
              const on = disabled || selected.has(p.key);
              return (
                <label
                  key={p.key}
                  className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                    on ? 'border-[var(--primary-orange)]/50 bg-[var(--primary-orange)]/10' : 'border-line'
                  } ${disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:border-[var(--primary-orange)]/40'}`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-[var(--primary-orange)]"
                    checked={on}
                    disabled={disabled}
                    onChange={() => toggle(p.key)}
                  />
                  <span>
                    <span className="block font-medium text-ink-primary">{p.label}</span>
                    <span className="block text-xs text-ink-muted">{p.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {googleSinBusquedas && !disabled && (
        <p className="text-xs text-amber-400">
          Google Places se usa dentro de las búsquedas: sin «Búsquedas» este usuario no podrá aprovecharlo.
        </p>
      )}
    </div>
  );
}
