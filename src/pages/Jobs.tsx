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

// Rubros disponibles. La clave se guarda en search_jobs.categorias y el collector
// de OSM la traduce a filtros reales (ver RUBRO_TAGS en la Edge Function).
const RUBROS: { value: string; label: string }[] = [
  { value: 'restaurantes', label: 'Restaurantes' },
  { value: 'cafe_bar', label: 'Cafés y bares' },
  { value: 'belleza', label: 'Belleza y peluquerías' },
  { value: 'salud', label: 'Salud y clínicas' },
  { value: 'gimnasios', label: 'Gimnasios' },
  { value: 'hoteles', label: 'Hoteles y hospedaje' },
  { value: 'tiendas', label: 'Tiendas' },
  { value: 'talleres', label: 'Talleres y servicios' },
  { value: 'oficinas', label: 'Oficinas y profesionales' },
];
const RUBRO_LABEL = Object.fromEntries(RUBROS.map((r) => [r.value, r.label]));

const emptyJob: JobInput = { nombre: '', source_id: null, query: '', ciudad: '', radio_metros: 15000, cron: '', activo: true, max_resultados: 60, categorias: [] };

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

  const selectedSource = (sources ?? []).find((s) => s.id === editing?.source_id);
  const isGoogle = /google/i.test(selectedSource?.nombre ?? '');

  async function save() {
    if (!editing) return;
    if (!editing.nombre.trim()) { toast('Ponle un nombre a la búsqueda (es solo una etiqueta para reconocerla).', 'error'); return; }
    if (!editing.ciudad?.trim()) { toast('Elige la ciudad donde buscar.', 'error'); return; }
    // OSM se filtra por rubros; Google por el texto de consulta.
    if (isGoogle) {
      if (!editing.query?.trim()) { toast('Con Google, escribe qué buscar en "Consulta" (ej: restaurantes en Ibarra).', 'error'); return; }
    } else if (!(editing.categorias?.length)) {
      toast('Elige al menos un rubro (qué tipo de negocios buscar).', 'error'); return;
    }
    await upsert.mutateAsync({ ...editing, query: editing.query || '', ciudad: editing.ciudad || null, cron: editing.cron || null });
    toast(editing.id ? 'Búsqueda actualizada' : 'Búsqueda creada', 'success');
    setEditing(null);
  }

  function toggleRubro(r: string) {
    if (!editing) return;
    const cur = editing.categorias ?? [];
    setEditing({ ...editing, categorias: cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r] });
  }
  async function del(j: SearchJob) {
    if (!confirm(`¿Eliminar la búsqueda "${j.nombre}"? Se borra la configuración y su historial de ejecuciones. Los prospectos ya encontrados NO se borran.`)) return;
    try {
      await remove.mutateAsync(j.id);
      toast(`Búsqueda "${j.nombre}" eliminada`, 'warning');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo eliminar la búsqueda', 'error');
    }
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
          hint="Crea una búsqueda: ponle un nombre, elige la ciudad y los rubros (qué negocios traer). Luego 'Ejecutar ahora' corre el pipeline collector → normalizer → scorer. OSM es gratis; Google Places requiere API key."
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
                  <div className="text-xs text-ink-muted">
                    {j.categorias?.length
                      ? j.categorias.map((c) => RUBRO_LABEL[c] ?? c).join(', ')
                      : (j.query || 'todos los rubros')}
                  </div>
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
                    <button title="Editar" onClick={() => setEditing({ id: j.id, nombre: j.nombre, source_id: j.source_id, query: j.query, ciudad: j.ciudad ?? '', radio_metros: j.radio_metros ?? 15000, cron: j.cron ?? '', activo: j.activo, max_resultados: j.max_resultados ?? 60, categorias: j.categorias ?? [] })} className="p-1 text-ink-muted hover:text-ink-primary text-xs">✎</button>
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
          <div className="space-y-4">
            <div>
              <Input label="Nombre de la búsqueda" value={editing.nombre} onChange={(e) => setEditing({ ...editing, nombre: e.target.value })} placeholder="Restaurantes de Ibarra" />
              <p className="mt-1 text-xs text-ink-muted">Solo una etiqueta para reconocer esta búsqueda en la lista. No cambia qué se busca.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Select label="Fuente" value={editing.source_id ?? ''} onChange={(e) => setEditing({ ...editing, source_id: e.target.value || null })}>
                <option value="">— elegir —</option>
                {(sources ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </Select>
              <Input label="Ciudad" value={editing.ciudad ?? ''} onChange={(e) => setEditing({ ...editing, ciudad: e.target.value })} placeholder="Ibarra" />
            </div>

            {isGoogle ? (
              <div>
                <Input label="Consulta (Google)" value={editing.query} onChange={(e) => setEditing({ ...editing, query: e.target.value })} placeholder="restaurantes en Ibarra Ecuador" />
                <p className="mt-1 text-xs text-ink-muted">Google busca por este texto libre. Sé específico: escribe el tipo de negocio y la ciudad.</p>
              </div>
            ) : (
              <div>
                <span className="mb-1.5 block text-sm text-ink-secondary">Rubros a buscar</span>
                <div className="flex flex-wrap gap-1.5">
                  {RUBROS.map((r) => {
                    const on = editing.categorias?.includes(r.value) ?? false;
                    return (
                      <button
                        key={r.value}
                        type="button"
                        onClick={() => toggleRubro(r.value)}
                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                          on
                            ? 'border-[var(--primary-orange)] bg-[var(--primary-orange)]/15 text-[var(--primary-orange)]'
                            : 'border-line text-ink-secondary hover:text-ink-primary'
                        }`}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-xs text-ink-muted">Elige qué tipos de negocio traer. Con OpenStreetMap esto es lo que filtra los resultados (antes traía todo mezclado). Si no eliges ninguno, trae todos los rubros.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
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
