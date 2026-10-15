import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Loader2, Lock, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, Button, Card, Input } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { useMySecrets, useSecretMutations } from '@/hooks/useSecrets';
import { useUIStore } from '@/store/uiStore';
import { timeAgo } from '@/lib/format';
import { getWebhookStatus, type Canal } from '@/lib/data/notifications';
import { getGlobalGoogleKeyStatus } from '@/lib/data/users';
import type { SecretKey } from '@/lib/data/secrets';

interface SecretRowProps {
  clave: SecretKey;
  label: string;
  description: string;
  placeholder: string;
  inputLabel: string;
  /** Si es false, la fila se muestra bloqueada. */
  enabled: boolean;
  /** Solo super admin: ya hay un secreto global del proyecto que respalda esta fila. */
  globalActive?: boolean;
}

/** Una credencial propia: se puede guardar, reemplazar y borrar, pero nunca volver a leer. */
function SecretRow({ clave, label, description, placeholder, inputLabel, enabled, globalActive }: SecretRowProps) {
  const { data: secrets, isLoading } = useMySecrets();
  const { save, remove } = useSecretMutations();
  const toast = useUIStore((s) => s.toast);
  const [value, setValue] = useState('');

  const current = secrets?.[clave];

  async function onSave() {
    const v = value.trim();
    if (!v) { toast('Pega primero el valor.', 'error'); return; }
    try {
      await save.mutateAsync({ clave, valor: v });
      setValue('');
      toast(`${label}: guardado de forma cifrada.`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error');
    }
  }

  async function onRemove() {
    if (!confirm(`¿Quitar "${label}"? Dejará de usarse de inmediato.`)) return;
    try {
      await remove.mutateAsync(clave);
      toast(`${label}: eliminado.`, 'warning');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error');
    }
  }

  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-ink-primary">{label}</p>
          <p className="text-xs text-ink-muted">{description}</p>
        </div>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-ink-muted" />
        ) : current ? (
          <Badge variant="success">
            <CheckCircle2 className="mr-1 inline h-3 w-3" />
            Configurado · ····{current.ultimos4 ?? ''}
          </Badge>
        ) : globalActive ? (
          <Badge variant="info">
            <CheckCircle2 className="mr-1 inline h-3 w-3" />
            Activa · global del proyecto
          </Badge>
        ) : (
          <Badge variant="default"><XCircle className="mr-1 inline h-3 w-3" />Sin configurar</Badge>
        )}
      </div>

      {enabled ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <Input
              label={current ? `${inputLabel} (reemplazar)` : inputLabel}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
            />
          </div>
          <Button size="sm" onClick={onSave} loading={save.isPending} disabled={!value.trim()}>
            Guardar
          </Button>
          {current && (
            <Button size="sm" variant="ghost" onClick={onRemove} loading={remove.isPending}>
              <Trash2 className="h-4 w-4" /> Quitar
            </Button>
          )}
        </div>
      ) : null}

      {current && (
        <p className="mt-2 text-[11px] text-ink-muted">Actualizado {timeAgo(current.updated_at)}</p>
      )}
    </div>
  );
}

function Locked({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-line px-3 py-3 text-sm text-ink-muted">
      <Lock className="h-4 w-4 shrink-0" /> {text}
    </div>
  );
}

export default function Integrations() {
  const { can, isOwner } = useAuth();
  const canGoogle = can('google_places');
  const canDiscord = can('discord');

  // El super admin tiene respaldo en los secretos globales de Supabase: si no hay
  // clave propia, la fila debe decir que SÍ funciona (no "Sin configurar").
  const globalGoogle = useQuery({
    queryKey: ['global-google-key'],
    queryFn: getGlobalGoogleKeyStatus,
    enabled: isOwner && canGoogle,
    retry: false,
  });
  const webhooks = useQuery({
    queryKey: ['webhook-status'],
    queryFn: getWebhookStatus,
    enabled: isOwner && canDiscord,
    retry: false,
  });
  const hookActive = (canal: Canal) => isOwner && Boolean(webhooks.data?.[canal]);

  return (
    <div>
      <PageHeader
        title="Integraciones"
        description="Tus propias claves y conexiones. Solo tu cuenta las usa."
      />

      <p className="mb-4 flex items-start gap-1.5 text-xs text-ink-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Se guardan cifradas. Una vez guardadas no se pueden volver a ver (solo los últimos 4 caracteres):
        si la pierdes, vuelve a pegarla. Ni el administrador puede leerlas desde el panel.
      </p>

      <Card>
        <h3 className="mb-1 font-semibold text-ink-primary">Google Places</h3>
        <p className="mb-3 text-sm text-ink-secondary">
          Con tu API key tus búsquedas pueden usar Google Places (más datos: teléfono, reseñas, horarios).
          El costo se factura en <strong>tu</strong> cuenta de Google Cloud; KODA lleva un tope mensual de gasto por usuario.
        </p>
        {canGoogle ? (
          <SecretRow
            clave="google_places_api_key"
            label="API key de Google Places"
            description="Google Cloud Console → APIs y servicios → Credenciales. Activa «Places API (New)»."
            inputLabel="API key"
            placeholder="AIza…"
            enabled
            globalActive={isOwner && globalGoogle.data === true}
          />
        ) : (
          <Locked text="Google Places no está habilitado para tu usuario. Pídele al administrador que lo active." />
        )}
        {canGoogle && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-ink-primary"
            >
              <ExternalLink className="h-3 w-3" /> Crear una API key
            </a>
            <span>Recomendado: restringe la key a «Places API (New)».</span>
            {isOwner && <span>Si no configuras una, se usa la clave global del proyecto.</span>}
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <h3 className="mb-1 font-semibold text-ink-primary">Discord</h3>
        <p className="mb-3 text-sm text-ink-secondary">
          Un webhook por canal. En Discord: Ajustes del canal → Integraciones → Webhooks → «Copiar URL del webhook».
          Después prueba cada canal en la pantalla <strong>Discord</strong>.
        </p>
        {canDiscord ? (
          <div className="space-y-2">
            <SecretRow
              clave="discord_webhook_hot" label="Calientes"
              description="Prospectos que cruzan el umbral de score"
              inputLabel="URL del webhook" placeholder="https://discord.com/api/webhooks/…" enabled
              globalActive={hookActive('hot')}
            />
            <SecretRow
              clave="discord_webhook_nuevos" label="Nuevos"
              description="Altas recientes en tu base"
              inputLabel="URL del webhook" placeholder="https://discord.com/api/webhooks/…" enabled
              globalActive={hookActive('nuevos')}
            />
            <SecretRow
              clave="discord_webhook_reportes" label="Reportes"
              description="Resumen diario de tus prospectos"
              inputLabel="URL del webhook" placeholder="https://discord.com/api/webhooks/…" enabled
              globalActive={hookActive('reportes')}
            />
            <SecretRow
              clave="discord_webhook_errores" label="Errores"
              description="Fallos de tus búsquedas"
              inputLabel="URL del webhook" placeholder="https://discord.com/api/webhooks/…" enabled
              globalActive={hookActive('errores')}
            />
          </div>
        ) : (
          <Locked text="Discord no está habilitado para tu usuario. Pídele al administrador que lo active." />
        )}
      </Card>
    </div>
  );
}
