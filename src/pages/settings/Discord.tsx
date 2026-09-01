import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Send, RefreshCw, FileBarChart, Save, CheckCircle2, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, Button, Input, Badge, Table, THead, TBody, TR, TH, TD } from '@/components/ui';
import { useUIStore } from '@/store/uiStore';
import { timeAgo } from '@/lib/format';
import {
  getWebhookStatus, sendTestNotification, flushNotifications, runDigest,
  getConfigNumber, setConfigNumber, listRecentNotifications, type Canal,
} from '@/lib/data/notifications';

const CANALES: { canal: Canal; label: string; desc: string }[] = [
  { canal: 'hot', label: 'Calientes', desc: 'Prospectos que cruzan el umbral de score' },
  { canal: 'nuevos', label: 'Nuevos', desc: 'Altas recientes en la base' },
  { canal: 'reportes', label: 'Reportes', desc: 'Resumen diario / semanal (digest)' },
  { canal: 'errores', label: 'Errores', desc: 'Fallos del pipeline de ingesta' },
];

const statusVariant: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  enviado: 'success', pendiente: 'warning', error: 'error',
};

export default function Discord() {
  const qc = useQueryClient();
  const toast = useUIStore((s) => s.toast);
  const [testing, setTesting] = useState<Canal | null>(null);
  const [busy, setBusy] = useState<'flush' | 'digest' | null>(null);
  const [threshold, setThreshold] = useState('');
  const [savingT, setSavingT] = useState(false);

  const status = useQuery({ queryKey: ['webhook-status'], queryFn: getWebhookStatus, retry: false });
  const thresholdQ = useQuery({ queryKey: ['hot-threshold'], queryFn: () => getConfigNumber('hot_threshold', 75) });
  const recent = useQuery({ queryKey: ['notif-recent'], queryFn: () => listRecentNotifications(20) });

  useEffect(() => {
    if (thresholdQ.data != null) setThreshold(String(thresholdQ.data));
  }, [thresholdQ.data]);

  async function saveThreshold() {
    const n = Number(threshold);
    if (!Number.isFinite(n) || n < 0 || n > 100) { toast('El umbral debe estar entre 0 y 100.', 'error'); return; }
    setSavingT(true);
    try {
      await setConfigNumber('hot_threshold', n);
      qc.invalidateQueries({ queryKey: ['hot-threshold'] });
      toast(`Umbral caliente guardado en ${n}. Aplica en la próxima corrida del scorer.`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error');
    } finally { setSavingT(false); }
  }

  async function test(canal: Canal) {
    setTesting(canal);
    try {
      await sendTestNotification(canal);
      toast(`Mensaje de prueba enviado al canal "${canal}". Revisá Discord.`, 'success');
      qc.invalidateQueries({ queryKey: ['notif-recent'] });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo enviar la prueba', 'error');
    } finally { setTesting(null); }
  }

  async function flush() {
    setBusy('flush');
    try {
      const r = await flushNotifications();
      toast(`Cola enviada: ${r.enviados} enviados, ${r.fallidos} con problemas.`, r.fallidos ? 'warning' : 'success');
      qc.invalidateQueries({ queryKey: ['notif-recent'] });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo enviar la cola', 'error');
    } finally { setBusy(null); }
  }

  async function digest() {
    setBusy('digest');
    try {
      const r = await runDigest();
      toast(`Resumen generado y encolado (${r.nuevos} nuevos, ${r.calientes} calientes). Se envía con la cola.`, 'success');
      qc.invalidateQueries({ queryKey: ['notif-recent'] });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el resumen', 'error');
    } finally { setBusy(null); }
  }

  const webhooks = status.data;

  return (
    <div>
      <PageHeader
        title="Discord"
        description="Canales, webhooks y umbral de score para notificar."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Umbral caliente */}
        <Card>
          <h3 className="mb-1 font-semibold text-ink-primary">Umbral de "caliente"</h3>
          <p className="mb-3 text-sm text-ink-secondary">
            Score mínimo para marcar un prospecto como caliente y avisar en Discord.
          </p>
          <div className="flex items-end gap-2">
            <Input
              label="Score mínimo (0–100)"
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-40"
            />
            <Button onClick={saveThreshold} loading={savingT} size="sm"><Save className="h-4 w-4" /> Guardar</Button>
          </div>
        </Card>

        {/* Acciones */}
        <Card>
          <h3 className="mb-1 font-semibold text-ink-primary">Acciones</h3>
          <p className="mb-3 text-sm text-ink-secondary">
            Envío manual (normalmente lo hace el cron automáticamente).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={flush} loading={busy === 'flush'}>
              <RefreshCw className="h-4 w-4" /> Enviar cola ahora
            </Button>
            <Button variant="secondary" size="sm" onClick={digest} loading={busy === 'digest'}>
              <FileBarChart className="h-4 w-4" /> Generar resumen
            </Button>
          </div>
        </Card>
      </div>

      {/* Webhooks por canal */}
      <Card className="mt-4">
        <h3 className="mb-1 font-semibold text-ink-primary">Canales y webhooks</h3>
        <p className="mb-3 text-sm text-ink-secondary">
          Las URLs de webhook son secretos: se guardan en Supabase (Settings → Edge Functions → Secrets),
          nunca en esta pantalla. Para cada canal, agregá el secret{' '}
          <code className="text-ink-primary">DISCORD_WEBHOOK_&lt;CANAL&gt;</code> (o{' '}
          <code className="text-ink-primary">DISCORD_WEBHOOK_DEFAULT</code> como respaldo).
        </p>

        {status.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" /> Consultando estado…</div>
        ) : status.isError ? (
          <p className="text-sm text-red-400">
            No se pudo consultar el estado. ¿Está desplegada la función koda-notifier?
          </p>
        ) : (
          <div className="space-y-2">
            {CANALES.map(({ canal, label, desc }) => {
              const ok = webhooks?.[canal];
              return (
                <div key={canal} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink-primary">{label}</span>
                      <code className="text-xs text-ink-muted">DISCORD_WEBHOOK_{canal.toUpperCase()}</code>
                    </div>
                    <p className="truncate text-xs text-ink-muted">{desc}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {ok ? (
                      <Badge variant="success"><CheckCircle2 className="mr-1 inline h-3 w-3" />Configurado</Badge>
                    ) : (
                      <Badge variant="default"><XCircle className="mr-1 inline h-3 w-3" />Sin webhook</Badge>
                    )}
                    <Button
                      variant="ghost" size="sm"
                      disabled={!ok || testing === canal}
                      onClick={() => test(canal)}
                    >
                      {testing === canal ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Probar
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Historial reciente */}
      <Card className="mt-4">
        <h3 className="mb-3 font-semibold text-ink-primary">Últimas notificaciones</h3>
        {recent.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
        ) : (recent.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">Todavía no hay notificaciones registradas.</p>
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent"><TH>Canal</TH><TH>Estado</TH><TH>Cuándo</TH><TH>Detalle</TH></TR>
            </THead>
            <TBody>
              {(recent.data ?? []).map((n) => (
                <TR key={n.id}>
                  <TD className="capitalize text-ink-secondary">{n.canal}</TD>
                  <TD><Badge variant={statusVariant[n.status] ?? 'default'}>{n.status}</Badge></TD>
                  <TD className="text-xs text-ink-secondary">{timeAgo(n.enviado_at ?? n.created_at)}</TD>
                  <TD className="text-xs text-ink-muted">{n.error_mensaje ?? (n.intento ? `${n.intento} intento(s)` : '—')}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
