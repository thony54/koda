import { Loader2, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, Table, THead, TBody, TR, TH, TD, Select } from '@/components/ui';
import { useUsers, useUpdateUser } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/store/uiStore';
import { formatDate } from '@/lib/format';
import type { UserRole } from '@/types/database';

const ROLES: UserRole[] = ['super_admin', 'analista', 'lector'];
const roleLabel: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  analista: 'Analista',
  lector: 'Lector',
};

export default function UsersAdmin() {
  const { data: users, isLoading } = useUsers();
  const { profile } = useAuth();
  const update = useUpdateUser();
  const toast = useUIStore((s) => s.toast);

  async function changeRole(id: string, rol: UserRole) {
    await update.mutateAsync({ id, patch: { rol } });
    toast('Rol actualizado', 'success');
  }
  async function toggleActivo(id: string, activo: boolean) {
    await update.mutateAsync({ id, patch: { activo } });
    toast(activo ? 'Usuario activado' : 'Usuario desactivado', activo ? 'success' : 'warning');
  }

  return (
    <div>
      <PageHeader title="Usuarios" description="Alta, rol y activación. Solo Super Admin." />

      {isLoading ? (
        <div className="grid place-items-center py-20 text-ink-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Usuario</TH><TH>Rol</TH><TH>Estado</TH><TH>Alta</TH>
            </TR>
          </THead>
          <TBody>
            {(users ?? []).map((u) => {
              const isSelf = u.id === profile?.id;
              return (
                <TR key={u.id}>
                  <TD>
                    <div className="font-medium text-ink-primary">{u.nombre || '—'} {isSelf && <span className="text-xs text-ink-muted">(vos)</span>}</div>
                    <div className="text-xs text-ink-muted">{u.email}</div>
                  </TD>
                  <TD>
                    <Select
                      value={u.rol}
                      onChange={(e) => changeRole(u.id, e.target.value as UserRole)}
                      className="!min-h-[32px] !py-1 max-w-[150px]"
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                    </Select>
                  </TD>
                  <TD>
                    {u.activo ? (
                      <button onClick={() => toggleActivo(u.id, false)} disabled={isSelf}>
                        <Badge variant="success">Activo</Badge>
                      </button>
                    ) : (
                      <button onClick={() => toggleActivo(u.id, true)}>
                        <Badge variant="error">Inactivo</Badge>
                      </button>
                    )}
                  </TD>
                  <TD className="text-xs text-ink-muted">{formatDate(u.created_at)}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-muted">
        <ShieldCheck className="h-3.5 w-3.5" />
        No hay registro público: los usuarios se crean en Supabase Auth y aquí se les asigna rol.
      </p>
    </div>
  );
}
