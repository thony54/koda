import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, KeyRound, Loader2, MessageSquare, Pencil, ShieldCheck, UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, Button, Table, THead, TBody, TR, TH, TD } from '@/components/ui';
import { CreateUserModal, EditUserModal } from '@/components/users/UserModals';
import { useUsers, useUserStats, useUpdateUser } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/store/uiStore';
import { useScopeStore } from '@/store/scopeStore';
import { PERMISSION_LABEL } from '@/lib/permissions';
import { formatDate, timeAgo } from '@/lib/format';
import type { UserProfile } from '@/lib/data/admin';
import type { UserRole } from '@/types/database';

const roleLabel: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  analista: 'Analista',
  lector: 'Lector',
};

export default function UsersAdmin() {
  const { data: users, isLoading } = useUsers();
  const { data: stats } = useUserStats();
  const { profile } = useAuth();
  const update = useUpdateUser();
  const toast = useUIStore((s) => s.toast);
  const setScope = useScopeStore((s) => s.setScope);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserProfile | null>(null);

  const statsById = useMemo(() => new Map((stats ?? []).map((s) => [s.user_id, s])), [stats]);

  async function toggleActivo(u: UserProfile) {
    try {
      await update.mutateAsync({ id: u.id, patch: { activo: !u.activo } });
      toast(u.activo ? 'Usuario desactivado' : 'Usuario activado', u.activo ? 'warning' : 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cambiar el estado', 'error');
    }
  }

  /** Cambia el alcance del admin a los datos de ese usuario y abre su lista de prospectos. */
  function viewAs(u: UserProfile) {
    const isSelf = u.id === profile?.id;
    setScope(u.id, isSelf ? 'Mis datos' : (u.nombre || u.email));
    qc.invalidateQueries();
    navigate('/prospectos');
  }

  return (
    <div>
      <PageHeader
        title="Usuarios"
        description="Crea cuentas, elige qué funciones tiene cada una y mira cuánto usa cada usuario."
        actions={<Button size="sm" onClick={() => setCreating(true)}><UserPlus className="h-4 w-4" /> Nuevo usuario</Button>}
      />

      {isLoading ? (
        <div className="grid place-items-center py-20 text-ink-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Usuario</TH><TH>Acceso</TH><TH>Funciones</TH><TH>Su base</TH><TH>Integraciones</TH><TH>Estado</TH><TH></TH>
            </TR>
          </THead>
          <TBody>
            {(users ?? []).map((u) => {
              const isSelf = u.id === profile?.id;
              const st = statsById.get(u.id);
              const isAdminRole = u.rol === 'super_admin';
              return (
                <TR key={u.id}>
                  <TD>
                    <div className="font-medium text-ink-primary">
                      {u.nombre || '—'} {isSelf && <span className="text-xs text-ink-muted">(tú)</span>}
                    </div>
                    <div className="text-xs text-ink-muted">{u.email}</div>
                    <div className="text-[11px] text-ink-muted">
                      {st?.ultimo_acceso ? `Último acceso ${timeAgo(st.ultimo_acceso)}` : `Alta ${formatDate(u.created_at)} · sin ingresar aún`}
                    </div>
                  </TD>
                  <TD>
                    <Badge variant={isAdminRole ? 'primary' : u.rol === 'analista' ? 'info' : 'default'}>
                      {roleLabel[u.rol]}
                    </Badge>
                  </TD>
                  <TD>
                    {isAdminRole ? (
                      <span className="text-xs text-ink-muted">Todas</span>
                    ) : u.permisos.length === 0 ? (
                      <span className="text-xs text-ink-muted">Ninguna</span>
                    ) : (
                      <div className="flex max-w-[260px] flex-wrap gap-1" title={u.permisos.map((p) => PERMISSION_LABEL[p] ?? p).join(', ')}>
                        {u.permisos.slice(0, 3).map((p) => (
                          <Badge key={p}>{PERMISSION_LABEL[p] ?? p}</Badge>
                        ))}
                        {u.permisos.length > 3 && <Badge>+{u.permisos.length - 3}</Badge>}
                      </div>
                    )}
                  </TD>
                  <TD className="text-xs text-ink-secondary">
                    {st ? (
                      <>
                        <div><strong className="text-ink-primary">{st.prospectos}</strong> prospectos · {st.calientes} calientes</div>
                        <div>{st.busquedas} búsquedas{st.costo_mes > 0 && ` · $${st.costo_mes.toFixed(2)} este mes`}</div>
                      </>
                    ) : '—'}
                  </TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <span title={st?.tiene_google ? 'Tiene su API key de Google Places' : 'Sin API key de Google'}>
                        <KeyRound className={`h-4 w-4 ${st?.tiene_google ? 'text-emerald-400' : 'text-ink-muted/40'}`} />
                      </span>
                      <span title={st?.tiene_discord ? 'Tiene webhooks de Discord' : 'Sin webhooks de Discord'}>
                        <MessageSquare className={`h-4 w-4 ${st?.tiene_discord ? 'text-emerald-400' : 'text-ink-muted/40'}`} />
                      </span>
                    </div>
                  </TD>
                  <TD>
                    <button onClick={() => toggleActivo(u)} disabled={isSelf || update.isPending} title={isSelf ? 'No puedes desactivarte a ti mismo' : 'Clic para cambiar'}>
                      {u.activo ? <Badge variant="success">Activo</Badge> : <Badge variant="error">Inactivo</Badge>}
                    </button>
                  </TD>
                  <TD>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => viewAs(u)}
                        title={isSelf ? 'Ver mis prospectos' : 'Ver los prospectos de este usuario'}
                        className="p-1 text-ink-muted hover:text-[var(--primary-orange)]"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button onClick={() => setEditing(u)} title="Editar" className="p-1 text-ink-muted hover:text-ink-primary">
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <p className="mt-4 flex items-start gap-1.5 text-xs text-ink-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        No hay registro público: las cuentas se crean aquí. Cada usuario trabaja con su propia base de prospectos,
        sus búsquedas y sus claves; solo el Super Admin puede ver los datos de todos (botón del ojo).
      </p>

      <CreateUserModal open={creating} onClose={() => setCreating(false)} />
      <EditUserModal
        user={editing}
        isSelf={editing?.id === profile?.id}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
