import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, RefreshCw } from 'lucide-react';
import { Button, Input, Modal, Select } from '@/components/ui';
import { PermissionPicker } from './PermissionPicker';
import { useUpdateUser } from '@/hooks/useAdmin';
import { useUIStore } from '@/store/uiStore';
import { createUser, generatePassword, resetUserPassword } from '@/lib/data/users';
import { PERMISSION_PRESETS, type PermissionKey } from '@/lib/permissions';
import type { UserProfile } from '@/lib/data/admin';
import type { UserRole } from '@/types/database';

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'analista', label: 'Analista — puede editar sus datos' },
  { value: 'lector', label: 'Lector — solo consulta' },
  { value: 'super_admin', label: 'Super Admin — administra todo' },
];

const DEFAULT_PRESET = PERMISSION_PRESETS.find((p) => p.id === 'prospeccion')!.permisos;

async function copy(text: string, toast: (m: string, t?: 'success' | 'error') => void) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado al portapapeles', 'success');
  } catch {
    toast('No se pudo copiar: selecciónalo y cópialo a mano.', 'error');
  }
}

/** Campo de contraseña visible con botón para generar una nueva. */
function PasswordField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <Input label={label} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} />
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={() => onChange(generatePassword())}>
        <RefreshCw className="h-4 w-4" /> Generar
      </Button>
    </div>
  );
}

function parseTope(raw: string): number | null | 'invalid' {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : 'invalid';
}

// ── Crear usuario ───────────────────────────────────────────────────────────
export function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useUIStore((s) => s.toast);
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState<UserRole>('analista');
  const [permisos, setPermisos] = useState<PermissionKey[]>(DEFAULT_PRESET);
  const [tope, setTope] = useState('');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  // Cada vez que se abre, formulario limpio y contraseña temporal nueva.
  useEffect(() => {
    if (!open) return;
    setEmail(''); setNombre(''); setPassword(generatePassword()); setRol('analista');
    setPermisos(DEFAULT_PRESET); setTope(''); setCreated(null); setSaving(false);
  }, [open]);

  async function submit() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes('@')) { toast('Escribe un correo válido.', 'error'); return; }
    if (password.length < 8) { toast('La contraseña debe tener al menos 8 caracteres.', 'error'); return; }
    const topeVal = parseTope(tope);
    if (topeVal === 'invalid') { toast('El tope de costo debe ser un número positivo.', 'error'); return; }

    setSaving(true);
    try {
      await createUser({
        email: cleanEmail,
        password,
        nombre: nombre.trim() || undefined,
        rol,
        permisos: rol === 'super_admin' ? [] : permisos,
        tope_costo_mensual: topeVal,
      });
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['user-stats'] });
      setCreated({ email: cleanEmail, password });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo crear el usuario', 'error');
    } finally {
      setSaving(false);
    }
  }

  // Pantalla de éxito: la contraseña solo se muestra ahora.
  if (created) {
    const mensaje = `Acceso a KODA\nEnlace: ${window.location.origin}\nCorreo: ${created.email}\nContraseña temporal: ${created.password}`;
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Usuario creado"
        size="md"
        footer={<Button onClick={onClose}>Listo</Button>}
      >
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-emerald-400">
            <Check className="h-4 w-4" /> {created.email} ya puede entrar a KODA.
          </p>
          <p className="text-sm text-ink-secondary">
            Compártele estos datos. La contraseña <strong>no se vuelve a mostrar</strong> (si se pierde, la restableces desde «Editar»).
          </p>
          <pre className="whitespace-pre-wrap rounded-md border border-line bg-surface-elevated p-3 text-xs text-ink-primary">{mensaje}</pre>
          <Button variant="secondary" size="sm" onClick={() => copy(mensaje, toast)}>
            <Copy className="h-4 w-4" /> Copiar datos de acceso
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo usuario"
      size="lg"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={submit} loading={saving}>Crear usuario</Button>
      </>}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="persona@empresa.com" autoComplete="off" />
          <Input label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre y apellido" />
        </div>
        <div>
          <PasswordField label="Contraseña temporal" value={password} onChange={setPassword} />
          <p className="mt-1 text-xs text-ink-muted">Se la entregas tú. No hay registro público: nadie puede crearse una cuenta solo.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Nivel de acceso" value={rol} onChange={(e) => setRol(e.target.value as UserRole)}>
            {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
          <div>
            <Input label="Tope mensual en APIs de pago (USD)" type="number" min={0} value={tope} onChange={(e) => setTope(e.target.value)} placeholder="Vacío = valor por defecto" />
          </div>
        </div>

        <div>
          <span className="mb-2 block text-sm font-medium text-ink-secondary">Funciones habilitadas</span>
          <PermissionPicker value={permisos} onChange={setPermisos} disabled={rol === 'super_admin'} />
          {rol === 'super_admin' && (
            <p className="mt-2 text-xs text-ink-muted">El Super Admin tiene todas las funciones y ve los datos de todos los usuarios.</p>
          )}
        </div>
        <p className="text-xs text-ink-muted">
          Cada usuario tendrá su propia base de prospectos, sus búsquedas y sus claves (Google Places, Discord): no ve nada de los demás.
        </p>
      </div>
    </Modal>
  );
}

// ── Editar usuario ──────────────────────────────────────────────────────────
export function EditUserModal({ user, isSelf, onClose }: { user: UserProfile | null; isSelf: boolean; onClose: () => void }) {
  const toast = useUIStore((s) => s.toast);
  const update = useUpdateUser();
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState<UserRole>('analista');
  const [activo, setActivo] = useState(true);
  const [permisos, setPermisos] = useState<PermissionKey[]>([]);
  const [tope, setTope] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setNombre(user.nombre ?? '');
    setRol(user.rol);
    setActivo(user.activo);
    setPermisos(user.permisos ?? []);
    setTope(user.tope_costo_mensual != null ? String(user.tope_costo_mensual) : '');
    setNewPassword(generatePassword());
    setResetDone(null);
  }, [user]);

  if (!user) return null;

  async function save() {
    if (!user) return;
    const topeVal = parseTope(tope);
    if (topeVal === 'invalid') { toast('El tope de costo debe ser un número positivo.', 'error'); return; }
    try {
      await update.mutateAsync({
        id: user.id,
        patch: {
          nombre: nombre.trim() || user.email,
          rol,
          activo,
          permisos: rol === 'super_admin' ? [] : permisos,
          tope_costo_mensual: topeVal,
        },
      });
      toast('Usuario actualizado', 'success');
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error');
    }
  }

  async function doReset() {
    if (!user) return;
    if (newPassword.length < 8) { toast('La contraseña debe tener al menos 8 caracteres.', 'error'); return; }
    if (!confirm(`¿Cambiar la contraseña de ${user.email}? Su contraseña actual dejará de funcionar.`)) return;
    setResetting(true);
    try {
      await resetUserPassword(user.id, newPassword);
      setResetDone(newPassword);
      toast('Contraseña restablecida', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo restablecer', 'error');
    } finally {
      setResetting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Editar · ${user.email}`}
      size="lg"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={save} loading={update.isPending}>Guardar cambios</Button>
      </>}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <Input label="Tope mensual en APIs de pago (USD)" type="number" min={0} value={tope} onChange={(e) => setTope(e.target.value)} placeholder="Vacío = valor por defecto" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Nivel de acceso" value={rol} disabled={isSelf} onChange={(e) => setRol(e.target.value as UserRole)}>
            {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
          <Select label="Estado" value={activo ? '1' : '0'} disabled={isSelf} onChange={(e) => setActivo(e.target.value === '1')}>
            <option value="1">Activo — puede entrar</option>
            <option value="0">Inactivo — sin acceso (conserva sus datos)</option>
          </Select>
        </div>
        {isSelf && <p className="text-xs text-ink-muted">No puedes cambiar tu propio nivel ni desactivarte (te quedarías sin acceso).</p>}

        <div>
          <span className="mb-2 block text-sm font-medium text-ink-secondary">Funciones habilitadas</span>
          <PermissionPicker value={permisos} onChange={setPermisos} disabled={rol === 'super_admin'} />
          {rol === 'super_admin' && (
            <p className="mt-2 text-xs text-ink-muted">El Super Admin tiene todas las funciones.</p>
          )}
        </div>

        <div className="rounded-md border border-line p-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-ink-primary">
            <KeyRound className="h-4 w-4" /> Restablecer contraseña
          </p>
          <PasswordField label="Nueva contraseña" value={newPassword} onChange={setNewPassword} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={doReset} loading={resetting}>Cambiar contraseña</Button>
            {resetDone && (
              <Button variant="ghost" size="sm" onClick={() => copy(`Contraseña temporal de KODA: ${resetDone}`, toast)}>
                <Copy className="h-4 w-4" /> Copiar nueva contraseña
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
