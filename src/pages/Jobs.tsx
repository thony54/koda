import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Plus, Trash2, Loader2, Play, History, Clock } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';
import {
  Button, Input, Select, Badge, Modal, Table, THead, TBody, TR, TH, TD,
} from '@/components/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useJobs, useJobMutations } from '@/hooks/useJobs';
import { useSources } from '@/hooks/useAdmin';
import { useUIStore } from '@/store/uiStore';
import { timeAgo } from '@/lib/format';
import { runJobNow, type SearchJob, type JobInput } from '@/lib/data/jobs';

const statusVariant: Record<string, 'success' | 'warning' | 'error' | 'default' | 'info'> = {
  ok: 'success', corriendo: 'info', pendiente: 'default', error: 'error', cancelado: 'warning',
};

const emptyJob: JobInput = { nombre: '', source_id: null, query: '', ciudad: '', radio_metros: 15000, cron: '', activo: true, max_resultados: 60 };

export default function Jobs() {
  const { data: jobs, isLoading } = useJobs();
  const { data: sources } = useSources();
  const { upsert, remove } = useJobMutations();
  const toast = useUIStore((s) => s.toast);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<(JobInput & { id?: string }) | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  async function runNow(j: SearchJob) {
    setRunning(j.id);
    toast(`Ejecutando "${j.nombre}"…`, 'info');
    try {
      const r = await runJobNow(j.id);
      toast(`"${j.nombre}": ${r.encontrados} encontrados, ${r.nuevos} nuevos, ${r.calientes} calientes`, 'success');
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['prospects'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (e) {
      toast(`Error al ejecutar: ${e instanceof Error ? e.message : 'desconocido'}`, 'error');
    } finally {
      setRunning(null);
    }
  }

  async function save() {
    if (!editing) return;
    if (!editing.nombre.trim() || !editing.query.trim()) { toast('Nombre y consulta son obligatorios.', 'error'); return; }
    await upsert.mutateAsync({ ...editing, ciudad: editing.ciudad || null, cron: editing.cron || null });
    toast(editing.id ? 'Búsqueda actualizada' : 'Búsqueda creada', 'success');
    setEditing(null);
  }
  async function del(j: SearchJob) {
    await remove.mutateAsync(j.id);
    toast(`Búsqueda "${j.nombre}" eliminada`, 'warning');
  }

  return (
    <div>
      <PageHeader
        title="Búsquedas"
        description="Trabajos de ingesta programados y manuales."
        actions={<Button size="sm" onClick={() => setEditing({ ...emptyJob })}><Plus className="h-4 w-4" /> Nueva búsqueda</Button>}
      />

      {isLoading ? (
        <div className="grid place-items-center py-20 text-ink-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (jobs ?? []).length === 0 ? (
        <EmptyState
          icon={<Search className="h-6 w-6" />}
          title="Aún no hay búsquedas configuradas"
          hint="Crea una búsqueda eligiendo fuente, consulta, ciudad y horario. Con las Edge Functions desplegadas, 'Ejecutar ahora' corre el pipeline collector → normalizer → scorer. OSM es gratis; Google Places requiere API key."
          action={<Button size="sm" onClick={() => setEditing({ ...emptyJob })}><Plus className="h-4 w-4" /> Nueva búsqueda</Button>}
        />
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Nombre</TH><TH>Fuente</TH><TH>Ciudad</TH><TH>Horario</TH><TH>Último resultado</TH><TH>Estado</TH><TH></TH>
            </TR>
          </THead>
          <TBody>
            {(jobs ?? []).map((j) => (
              <TR key={j.id}>
                <TD>
                  <div className="font-medium text-ink-primary">{j.nombre}</div>
                  <div className="text-xs text-ink-muted">{j.query}</div>
                </TD>
                <TD className="text-ink-secondary">{j.source_nombre ?? '—'}</TD>
                <TD className="text-ink-secondary">{j.ciudad ?? '—'}</TD>
                <TD>
                  {j.cron ? <span className="inline-flex items-center gap-1 text-xs text-ink-secondary"><Clock className="h-3 w-3" /><code>{j.cron}</code></span> : <span className="text-xs text-ink-muted">manual</span>}
                </TD>
                <TD className="text-xs text-ink-secondary">
                  {j.ultimo ? `${j.ultimo.encontrados} enc · ${j.ultimo.nuevos} nuevos · ${timeAgo(j.last_run_at)}` : 'sin correr'}
                </TD>
                <TD>{j.ultimo ? <Badge variant={statusVariant[j.ultimo.status] ?? 'default'}>{j.ultimo.status}</Badge> : <Badge>{j.activo ? 'activa' : 'inactiva'}</Badge>}</TD>
                <TD>
                  <div className="flex items-center gap-1">
                    <button title="Ejecutar ahora" disabled={running === j.id} onClick={() => runNow(j)} className="p-1 text-ink-muted hover:text-[var(--primary-orange)] disabled:opacity-50">
                      {running === j.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    </button>
                    <Link to={`/busquedas/${j.id}/runs`} title="Historial" className="p-1 text-ink-muted hover:text-ink-primary"><History className="h-4 w-4" /></Link>
                    <button title="Editar" onClick={() => setEditing({ id: j.id, nombre: j.nombre, source_id: j.source_id, query: j.query, ciudad: j.ciudad ?? '', radio_metros: j.radio_metros ?? 15000, cron: j.cron ?? '', activo: j.activo, max_resultados: j.max_resultados ?? 60 })} className="p-1 text-ink-muted hover:text-ink-primary text-xs">✎</button>
                    <button title="Eliminar" onClick={() => del(j)} className="p-1 text-ink-muted hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar búsqueda' : 'Nueva búsqueda'}
        footer={<>
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
          <Button onClick={save} loading={upsert.isPending}>Guardar</Button>
        </>}
      >
        {editing && (
          <div className="space-y-3">
            <Input label="Nombre" value={editing.nombre} onChange={(e) => setEditing({ ...editing, nombre: e.target.value })} placeholder="Restaurantes Ibarra sin web" />
            <Input label="Consulta" value={editing.query} onChange={(e) => setEditing({ ...editing, query: e.target.value })} placeholder="restaurantes en Ibarra Ecuador" />
            <div className="grid grid-cols-2 gap-3">
              <Select label="Fuente" value={editing.source_id ?? ''} onChange={(e) => setEditing({ ...editing, source_id: e.target.value || null })}>
                <option value="">— elegir —</option>
                {(sources ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </Select>
              <Input label="Ciudad" value={editing.ciudad ?? ''} onChange={(e) => setEditing({ ...editing, ciudad: e.target.value })} placeholder="Ibarra" />
              <Input label="Radio (m)" type="number" value={String(editing.radio_metros ?? 15000)} onChange={(e) => setEditing({ ...editing, radio_metros: Number(e.target.value) })} />
              <Input label="Máx. resultados" type="number" value={String(editing.max_resultados ?? 60)} onChange={(e) => setEditing({ ...editing, max_resultados: Number(e.target.value) })} />
              <Input label="Cron (vacío = manual)" value={editing.cron ?? ''} onChange={(e) => setEditing({ ...editing, cron: e.target.value })} placeholder="0 7 * * *" className="col-span-2" />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
