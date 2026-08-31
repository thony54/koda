import { useMemo, useState } from 'react';
import { Users, Download, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';
import { Filters, STATUS_LABEL } from '@/components/prospects/Filters';
import { ProspectTable } from '@/components/prospects/ProspectTable';
import { Button } from '@/components/ui';
import { useProspects, useUpdateProspect } from '@/hooks/useProspects';
import type { ProspectFilters, SortField, SortDir } from '@/lib/data/prospects';
import type { Prospect, ProspectStatus } from '@/types/domain';
import { useUIStore } from '@/store/uiStore';

const PAGE_SIZE = 15;

function exportCSV(rows: Prospect[]) {
  const headers = ['nombre', 'tipo', 'categoria', 'ciudad', 'score', 'plan_sugerido', 'status', 'whatsapp', 'website', 'instagram'];
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = rows.map((r) => headers.map((h) => escape((r as unknown as Record<string, unknown>)[h])).join(','));
  const csv = [headers.join(','), ...body].join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `prospectos-koda-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Prospects() {
  const [filters, setFilters] = useState<ProspectFilters>({});
  const [sortBy, setSortBy] = useState<SortField>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toast = useUIStore((s) => s.toast);
  const updateProspect = useUpdateProspect();

  const params = useMemo(
    () => ({ ...filters, sortBy, sortDir, page, pageSize: PAGE_SIZE }),
    [filters, sortBy, sortDir, page],
  );
  const { data, isLoading, isFetching } = useProspects(params);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function onSort(field: SortField) {
    if (field === sortBy) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(field);
      setSortDir(field === 'nombre' || field === 'ciudad' ? 'asc' : 'desc');
    }
    setPage(1);
  }

  function changeFilters(next: ProspectFilters) {
    setFilters(next);
    setPage(1);
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleAll() {
    setSelected((s) => {
      const allHere = rows.every((r) => s.has(r.id));
      const n = new Set(s);
      rows.forEach((r) => (allHere ? n.delete(r.id) : n.add(r.id)));
      return n;
    });
  }

  async function bulkStatus(status: ProspectStatus) {
    const ids = [...selected];
    await Promise.all(ids.map((id) => updateProspect.mutateAsync({ id, patch: { status } })));
    toast(`${ids.length} prospecto(s) → ${STATUS_LABEL[status]}`, 'success');
    setSelected(new Set());
  }

  function bulkExport() {
    const chosen = rows.filter((r) => selected.has(r.id));
    exportCSV(chosen.length ? chosen : rows);
    toast(`Exportados ${chosen.length || rows.length} prospectos a CSV`, 'success');
  }

  const noFilters = Object.keys(filters).length === 0;

  return (
    <div>
      <PageHeader
        title="Prospectos"
        description="La base de prospectos calificados de Connexo."
        actions={
          <Button variant="secondary" size="sm" onClick={() => exportCSV(rows)}>
            <Download className="h-4 w-4" /> Exportar CSV
          </Button>
        }
      />

      <Filters value={filters} onChange={changeFilters} />

      {/* Barra de acciones en lote */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-[var(--primary-orange)]/30 bg-[var(--primary-orange)]/10 px-3 py-2 text-sm">
          <span className="font-medium text-[var(--primary-orange)]">
            {selected.size} seleccionado(s)
          </span>
          <div className="mx-1 h-4 w-px bg-line" />
          <button onClick={() => bulkStatus('calificado')} className="rounded px-2 py-1 text-ink-secondary hover:bg-white/5 hover:text-ink-primary">Marcar calificado</button>
          <button onClick={() => bulkStatus('descartado')} className="rounded px-2 py-1 text-ink-secondary hover:bg-white/5 hover:text-ink-primary">Descartar</button>
          <button onClick={bulkExport} className="rounded px-2 py-1 text-ink-secondary hover:bg-white/5 hover:text-ink-primary">Exportar selección</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto rounded px-2 py-1 text-ink-muted hover:text-ink-primary">Limpiar</button>
        </div>
      )}

      {isLoading ? (
        <div className="grid place-items-center py-20 text-ink-muted">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title={noFilters ? 'Todavía no hay prospectos' : 'Ningún prospecto coincide'}
          hint={
            noFilters
              ? 'Crea una búsqueda o importa un CSV para empezar a llenar la base.'
              : 'Prueba con otros filtros o límpialos para ver todo.'
          }
          action={!noFilters ? <Button variant="secondary" size="sm" onClick={() => changeFilters({})}>Limpiar filtros</Button> : undefined}
        />
      ) : (
        <>
          <ProspectTable
            rows={rows}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            loading={isFetching}
          />

          {/* Paginación */}
          <div className="mt-3 flex items-center justify-between text-sm text-ink-secondary">
            <span>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} de {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-md border border-line p-1.5 disabled:opacity-40 hover:enabled:bg-white/5"
                aria-label="Anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2">{page} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-md border border-line p-1.5 disabled:opacity-40 hover:enabled:bg-white/5"
                aria-label="Siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
