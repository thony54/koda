import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, GitMerge, X, ArrowRight } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';
import { Card, Button, Badge } from '@/components/ui';
import { ScoreBadge } from '@/components/prospects/ScoreBadge';
import { findDuplicatePairs, deleteProspect, type DupCandidate, type DupPair } from '@/lib/data/prospects';
import { useUIStore } from '@/store/uiStore';
import { timeAgo } from '@/lib/format';

export default function Duplicates() {
  const { data: pairs, isLoading } = useQuery({ queryKey: ['dup-pairs'], queryFn: findDuplicatePairs });
  const qc = useQueryClient();
  const toast = useUIStore((s) => s.toast);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const pairKey = (p: DupPair) => [p.a.id, p.b.id].sort().join('|');
  const visible = useMemo(
    () => (pairs ?? []).filter((p) => !dismissed.has(pairKey(p))),
    [pairs, dismissed],
  );

  async function merge(keep: DupCandidate, drop: DupCandidate, p: DupPair) {
    await deleteProspect(drop.id);
    setDismissed((s) => new Set(s).add(pairKey(p)));
    qc.invalidateQueries({ queryKey: ['prospects'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    toast(`Fusionados: se conservó "${keep.nombre}" y se eliminó el duplicado`, 'success');
  }

  return (
    <div>
      <PageHeader
        title="Duplicados"
        description="Posibles duplicados detectados por nombre y ciudad. Revisá y fusioná manualmente."
      />

      {isLoading ? (
        <div className="grid place-items-center py-20 text-ink-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Copy className="h-6 w-6" />}
          title="No hay duplicados por revisar"
          hint="KODA no encontró prospectos con nombre y ciudad muy similares. Cuando aparezcan, se comparan aquí lado a lado."
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-secondary">{visible.length} par(es) a revisar.</p>
          {visible.map((p) => (
            <Card key={pairKey(p)}>
              <div className="mb-3 flex items-center justify-between">
                <Badge variant="warning">{p.motivo}</Badge>
                <button onClick={() => setDismissed((s) => new Set(s).add(pairKey(p)))} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink-primary">
                  <X className="h-3.5 w-3.5" /> Son distintos
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <DupCard c={p.a} />
                <div className="hidden text-ink-muted sm:block"><GitMerge className="h-5 w-5" /></div>
                <DupCard c={p.b} />
              </div>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => merge(p.a, p.b, p)}>
                  Conservar "{trunc(p.a.nombre)}" <ArrowRight className="h-3.5 w-3.5" /> eliminar el otro
                </Button>
                <Button size="sm" variant="secondary" onClick={() => merge(p.b, p.a, p)}>
                  Conservar "{trunc(p.b.nombre)}" <ArrowRight className="h-3.5 w-3.5" /> eliminar el otro
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function trunc(s: string) { return s.length > 18 ? s.slice(0, 18) + '…' : s; }

function DupCard({ c }: { c: DupCandidate }) {
  return (
    <div className="rounded-md border border-line bg-surface-elevated p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium text-ink-primary">{c.nombre}</span>
        <ScoreBadge score={c.score} />
      </div>
      <p className="text-xs text-ink-muted capitalize">{c.categoria} · {c.ciudad}</p>
      <div className="mt-2 space-y-0.5 text-xs text-ink-secondary">
        <p>Fuente: {c.source_nombre ?? '—'}</p>
        <p>Web: {c.tiene_website ? 'sí' : 'no'} · WhatsApp: {c.whatsapp ? 'sí' : 'no'}</p>
        <p>Visto {timeAgo(c.first_seen_at)}</p>
      </div>
    </div>
  );
}
