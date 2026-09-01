import { useState } from 'react';
import { Plus, Trash2, Loader2, KeyRound } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, Button, Input, Select, Badge, Table, THead, TBody, TR, TH, TD } from '@/components/ui';
import { useSources, useSourceMutations } from '@/hooks/useAdmin';
import { useUIStore } from '@/store/uiStore';
import type { Source } from '@/lib/data/admin';

const TIPOS = ['api', 'scraper', 'manual', 'csv'];

const emptyDraft = { nombre: '', tipo: 'api', base_url: '', rate_limit_por_min: 60, activo: true };

export default function Sources() {
  const { data: sources, isLoading } = useSources();
  const { upsert, remove } = useSourceMutations();
  const toast = useUIStore((s) => s.toast);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);

  async function add() {
    if (!draft.nombre.trim()) { toast('El nombre es obligatorio.', 'error'); return; }
    await upsert.mutateAsync({ ...draft, nombre: draft.nombre.trim(), base_url: draft.base_url || null });
    toast('Fuente agregada', 'success');
    setDraft(emptyDraft);
    setShowAdd(false);
  }

  async function toggle(s: Source) {
    await upsert.mutateAsync({ id: s.id, activo: !s.activo });
  }

  async function del(s: Source) {
    if (!confirm(`¿Eliminar la fuente "${s.nombre}"?`)) return;
    try {
      await remove.mutateAsync(s.id);
      toast(`Fuente "${s.nombre}" eliminada`, 'warning');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo eliminar la fuente', 'error');
    }
  }

  return (
    <div>
      <PageHeader
        title="Fuentes"
        description="Fuentes de datos, límites de tasa y estado."
        actions={<Button size="sm" onClick={() => setShowAdd((v) => !v)}><Plus className="h-4 w-4" /> Nueva fuente</Button>}
      />

      <Card className="mb-4 border border-amber-500/20 bg-amber-500/[0.06]">
        <p className="flex items-start gap-2 text-sm text-ink-secondary">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          Las claves de API (Google Places, etc.) NO se guardan aquí: viven en los
          <em> Secrets </em> de Supabase (Edge Functions) y nunca llegan al navegador.
        </p>
      </Card>

      {showAdd && (
        <Card className="mb-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_2fr_100px_auto] sm:items-end">
            <Input label="Nombre" value={draft.nombre} onChange={(e) => setDraft((d) => ({ ...d, nombre: e.target.value }))} placeholder="Cámara de Comercio" />
            <Select label="Tipo" value={draft.tipo} onChange={(e) => setDraft((d) => ({ ...d, tipo: e.target.value }))}>
              {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
            <Input label="Base URL" value={draft.base_url} onChange={(e) => setDraft((d) => ({ ...d, base_url: e.target.value }))} placeholder="https://…" />
            <Input label="Límite/min" type="number" value={String(draft.rate_limit_por_min)} onChange={(e) => setDraft((d) => ({ ...d, rate_limit_por_min: Number(e.target.value) }))} />
            <Button onClick={add} loading={upsert.isPending}>Agregar</Button>
          </div>
        </Card>
      )}

      {isLoading ? (
        <div className="grid place-items-center py-20 text-ink-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Nombre</TH><TH>Tipo</TH><TH>Base URL</TH><TH className="text-right">Límite/min</TH><TH>Activa</TH><TH></TH>
            </TR>
          </THead>
          <TBody>
            {(sources ?? []).map((s) => (
              <TR key={s.id}>
                <TD className="font-medium text-ink-primary">{s.nombre}</TD>
                <TD><Badge>{s.tipo}</Badge></TD>
                <TD className="text-ink-muted">{s.base_url ?? '—'}</TD>
                <TD className="text-right text-ink-secondary">{s.rate_limit_por_min}</TD>
                <TD>
                  <button onClick={() => toggle(s)} className={`h-5 w-9 rounded-full transition-colors relative ${s.activo ? 'bg-[var(--primary-orange)]' : 'bg-surface-elevated'}`} aria-label="Activar/desactivar">
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${s.activo ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                </TD>
                <TD>
                  <button onClick={() => del(s)} className="text-ink-muted hover:text-red-400" aria-label="Eliminar"><Trash2 className="h-4 w-4" /></button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
