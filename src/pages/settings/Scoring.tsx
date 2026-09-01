import { useMemo, useState } from 'react';
import { Plus, Trash2, Loader2, Play } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, Button, Input, Table, THead, TBody, TR, TH, TD } from '@/components/ui';
import { ScoreBadge } from '@/components/prospects/ScoreBadge';
import { useScoringRules, useScoringMutations, useSimulationBase } from '@/hooks/useAdmin';
import { clampScore } from '@/lib/scoring';
import { useUIStore } from '@/store/uiStore';
import type { ScoringRule } from '@/lib/data/admin';

export default function Scoring() {
  const { data: rules, isLoading } = useScoringRules();
  const { data: simBase } = useSimulationBase();
  const { upsert, update, remove } = useScoringMutations();
  const toast = useUIStore((s) => s.toast);

  // Ediciones locales de puntos (se guardan al salir del input).
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newRule, setNewRule] = useState({ clave: '', descripcion: '', puntos: 0 });

  const effectivePoints = useMemo(() => {
    const map: Record<string, number> = {};
    (rules ?? []).forEach((r) => {
      if (!r.activa) return;
      map[r.clave] = draft[r.id] ?? r.puntos;
    });
    return map;
  }, [rules, draft]);

  // Simulador: recomputa el score de cada prospecto con los puntos vigentes.
  const topSim = useMemo(() => {
    if (!simBase) return [];
    return simBase
      .map((p) => ({
        ...p,
        score: clampScore(p.claves.reduce((a, k) => a + (effectivePoints[k] ?? 0), 0)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  }, [simBase, effectivePoints]);

  async function savePoints(rule: ScoringRule) {
    const val = draft[rule.id];
    if (val == null || val === rule.puntos) return;
    await update.mutateAsync({ id: rule.id, patch: { puntos: val } });
    toast(`Regla "${rule.clave}" actualizada`, 'success');
  }

  async function toggleActiva(rule: ScoringRule) {
    await update.mutateAsync({ id: rule.id, patch: { activa: !rule.activa } });
  }

  async function addRule() {
    const clave = newRule.clave.trim().toLowerCase().replace(/\s+/g, '_');
    if (!clave || !newRule.descripcion.trim()) { toast('Clave y descripción son obligatorias.', 'error'); return; }
    await upsert.mutateAsync({ clave, descripcion: newRule.descripcion.trim(), puntos: newRule.puntos, activa: true, orden: (rules?.length ?? 0) + 1 });
    toast('Regla agregada', 'success');
    setNewRule({ clave: '', descripcion: '', puntos: 0 });
    setShowAdd(false);
  }

  async function removeRule(rule: ScoringRule) {
    if (!confirm(`¿Eliminar la regla "${rule.clave}"?`)) return;
    try {
      await remove.mutateAsync(rule.id);
      toast(`Regla "${rule.clave}" eliminada`, 'warning');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo eliminar la regla', 'error');
    }
  }

  return (
    <div>
      <PageHeader
        title="Reglas de scoring"
        description="Las reglas del KODA Score viven en la base. Editá los puntos y mirá el efecto en el simulador."
        actions={<Button size="sm" onClick={() => setShowAdd((v) => !v)}><Plus className="h-4 w-4" /> Nueva regla</Button>}
      />

      {showAdd && (
        <Card className="mb-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr_100px_auto] sm:items-end">
            <Input label="Clave" value={newRule.clave} onChange={(e) => setNewRule((r) => ({ ...r, clave: e.target.value }))} placeholder="tiene_delivery" />
            <Input label="Descripción" value={newRule.descripcion} onChange={(e) => setNewRule((r) => ({ ...r, descripcion: e.target.value }))} placeholder="Ofrece entregas a domicilio" />
            <Input label="Puntos" type="number" value={String(newRule.puntos)} onChange={(e) => setNewRule((r) => ({ ...r, puntos: Number(e.target.value) }))} />
            <Button onClick={addRule} loading={upsert.isPending}>Agregar</Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Tabla de reglas */}
        <div className="lg:col-span-2">
          {isLoading ? (
            <div className="grid place-items-center py-20 text-ink-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Clave</TH><TH>Descripción</TH><TH className="text-right">Puntos</TH><TH>Activa</TH><TH></TH>
                </TR>
              </THead>
              <TBody>
                {(rules ?? []).map((r) => (
                  <TR key={r.id} className={r.activa ? '' : 'opacity-50'}>
                    <TD><code className="text-xs text-[var(--primary-orange)]">{r.clave}</code></TD>
                    <TD className="text-ink-secondary">{r.descripcion}</TD>
                    <TD className="text-right">
                      <input
                        type="number"
                        value={draft[r.id] ?? r.puntos}
                        onChange={(e) => setDraft((d) => ({ ...d, [r.id]: Number(e.target.value) }))}
                        onBlur={() => savePoints(r)}
                        className="glass-input w-16 rounded px-2 py-1 text-right text-sm text-ink-primary outline-none"
                      />
                    </TD>
                    <TD>
                      <button
                        onClick={() => toggleActiva(r)}
                        className={`h-5 w-9 rounded-full transition-colors ${r.activa ? 'bg-[var(--primary-orange)]' : 'bg-surface-elevated'} relative`}
                        aria-label="Activar/desactivar"
                      >
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${r.activa ? 'left-[18px]' : 'left-0.5'}`} />
                      </button>
                    </TD>
                    <TD>
                      <button onClick={() => removeRule(r)} className="text-ink-muted hover:text-red-400" aria-label="Eliminar">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>

        {/* Simulador */}
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Play className="h-4 w-4 text-[var(--primary-orange)]" />
            <h2 className="font-heading text-lg text-ink-primary">Simulador</h2>
          </div>
          <p className="mb-3 text-xs text-ink-muted">
            Top 20 con las reglas actuales. Cambiá los puntos y la lista se reordena al instante.
          </p>
          {topSim.length === 0 ? (
            <p className="text-sm text-ink-muted">Sin prospectos para simular todavía.</p>
          ) : (
            <ol className="space-y-1.5">
              {topSim.map((p, i) => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <span className="w-5 text-center text-xs text-ink-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-secondary">{p.nombre}</span>
                  <ScoreBadge score={p.score} />
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
