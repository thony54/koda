import { useQueryClient } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useUsers } from '@/hooks/useAdmin';
import { useScopeStore } from '@/store/scopeStore';

const ALL = '__all__';

/**
 * Selector del Super Admin: ¿de quién son los datos que estoy viendo?
 * Los usuarios normales no lo ven (RLS ya les muestra solo lo suyo).
 */
export function ScopeSwitcher() {
  const { profile, isSuperAdmin } = useAuth();
  const { data: users } = useUsers(isSuperAdmin);
  const { ownerId, setScope } = useScopeStore();
  const qc = useQueryClient();

  if (!isSuperAdmin || !profile) return null;

  function onChange(value: string) {
    if (value === ALL) setScope(null, 'Todos los usuarios');
    else if (value === profile!.id) setScope(profile!.id, 'Mis datos');
    else {
      const u = (users ?? []).find((x) => x.id === value);
      setScope(value, u?.nombre || u?.email || 'Usuario');
    }
    // Todo lo cacheado pertenece al alcance anterior.
    qc.invalidateQueries();
  }

  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-muted" title="Datos que estás viendo">
      <Eye className="h-3.5 w-3.5" />
      <select
        value={ownerId ?? ALL}
        onChange={(e) => onChange(e.target.value)}
        className="glass-input max-w-[170px] cursor-pointer rounded-md px-2 py-1.5 text-xs text-ink-primary outline-none"
        aria-label="Ver datos de"
      >
        <option value={profile.id}>Mis datos</option>
        {(users ?? []).filter((u) => u.id !== profile.id).map((u) => (
          <option key={u.id} value={u.id}>{u.nombre || u.email}</option>
        ))}
        <option value={ALL}>Todos los usuarios</option>
      </select>
    </label>
  );
}

/** Aviso persistente cuando el admin mira (o escribe en) los datos de otra persona. */
export function ScopeBanner() {
  const { profile, isSuperAdmin } = useAuth();
  const { ownerId, label, setScope } = useScopeStore();
  const qc = useQueryClient();

  if (!isSuperAdmin || !profile || ownerId === profile.id) return null;

  const todos = ownerId === null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-[var(--primary-orange)]/30 bg-[var(--primary-orange)]/10 px-3 py-2 text-sm">
      <Eye className="h-4 w-4 text-[var(--primary-orange)]" />
      <span className="text-ink-primary">
        {todos
          ? 'Estás viendo los datos de TODOS los usuarios mezclados.'
          : <>Estás viendo los datos de <strong>{label}</strong>. Lo que crees aquí quedará en su base.</>}
      </span>
      <button
        onClick={() => { setScope(profile.id, 'Mis datos'); qc.invalidateQueries(); }}
        className="ml-auto text-xs font-medium text-[var(--primary-orange)] hover:underline"
      >
        Volver a mis datos
      </button>
    </div>
  );
}
