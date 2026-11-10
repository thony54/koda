import { useMemo, useState } from 'react';
import { CheckCheck, ChevronDown, Layers, MessageCircle, Pencil } from 'lucide-react';
import { Button } from '@/components/ui';
import { ESTADOS_PARA, ESTADOS_INVITADOS, etiquetaLote, type ConnexoEnvio, type ConnexoEstado, type ConnexoLote } from '@/lib/data/connexo';
import { timeAgo } from '@/lib/format';

/** Tramos de la barra de progreso de un lote, en el orden del embudo (de lo ya logrado a lo que falta). */
const TRAMOS: { clave: string; label: string; estados: ConnexoEstado[]; barra: string; punto: string }[] = [
  { clave: 'aceptado', label: 'aceptaron', estados: ['aceptado'], barra: 'bg-success', punto: 'bg-success' },
  { clave: 'enviado', label: 'con WhatsApp enviado', estados: ['wa_enviado'], barra: 'bg-warning', punto: 'bg-warning' },
  { clave: 'aprobado', label: 'aprobados', estados: ['aprobado'], barra: 'bg-accent', punto: 'bg-accent' },
  { clave: 'borrador', label: 'por revisar', estados: ['borrador', 'pendiente'], barra: 'bg-info', punto: 'bg-info' },
  { clave: 'no', label: 'dijeron no / vencieron', estados: ['declinado', 'vencido'], barra: 'bg-danger/70', punto: 'bg-danger/70' },
  { clave: 'otros', label: 'fuera del embudo', estados: ['descartado', 'sin_plantilla', 'error'], barra: 'bg-veil/30', punto: 'bg-veil/30' },
];

interface Props {
  lotes: ConnexoLote[];
  envios: ConnexoEnvio[];
  seleccionado: string | null;
  onSeleccionar: (id: string | null) => void;
  onAprobar: (lote: ConnexoLote, borradores: ConnexoEnvio[]) => void;
  onWhatsApp: (lote: ConnexoLote, aprobados: ConnexoEnvio[]) => void;
  onRenombrar: (lote: ConnexoLote) => void;
  /** No quedan envíos de WhatsApp por hoy (tope diario). */
  sinCupo: boolean;
  ocupado: boolean;
}

const VISIBLES = 6;

/**
 * Los lotes de un vistazo: cada tarjeta es una tanda que mandaste a Connexo, con cuántos van en cada paso del embudo
 * y los atajos para aprobarla o invitarla completa. Pulsar una tarjeta filtra la tabla de abajo a ese lote.
 */
export function LotesPanel({ lotes, envios, seleccionado, onSeleccionar, onAprobar, onWhatsApp, onRenombrar, sinCupo, ocupado }: Props) {
  const [todos, setTodos] = useState(false);

  const porLote = useMemo(() => {
    const m = new Map<string, ConnexoEnvio[]>();
    for (const e of envios) if (e.lote_id) m.set(e.lote_id, [...(m.get(e.lote_id) ?? []), e]);
    return m;
  }, [envios]);

  // Solo lotes que tienen algo a la vista (si el super admin mira a otro usuario, los demás no aplican).
  const conEnvios = lotes.filter((l) => porLote.has(l.id));
  const sinLote = envios.filter((e) => !e.lote_id).length;
  const lista = todos ? conEnvios : conEnvios.slice(0, VISIBLES);
  if (!conEnvios.length) return null;

  return (
    <section className="mb-5" aria-label="Lotes enviados a Connexo">
      <div className="mb-2 flex items-center gap-2 text-xs text-ink-muted">
        <Layers className="h-3.5 w-3.5" />
        <span className="font-medium uppercase tracking-wide">Lotes</span>
        <span className="num">{conEnvios.length}</span>
        {seleccionado && (
          <button type="button" onClick={() => onSeleccionar(null)} className="ml-auto rounded px-2 py-0.5 text-accent-text hover:bg-veil/[0.08]">
            Ver todos los lotes
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {lista.map((lote) => {
          const items = porLote.get(lote.id) ?? [];
          const borradores = items.filter((e) => ESTADOS_PARA.aprobar.includes(e.estado));
          const aprobados = items.filter((e) => ESTADOS_PARA.whatsapp.includes(e.estado));
          const invitados = items.filter((e) => ESTADOS_INVITADOS.includes(e.estado)).length;
          const aceptaron = items.filter((e) => e.estado === 'aceptado').length;
          const activo = seleccionado === lote.id;
          const tramos = TRAMOS.map((t) => ({ ...t, n: items.filter((e) => t.estados.includes(e.estado)).length })).filter((t) => t.n > 0);

          return (
            <article
              key={lote.id}
              data-testid="lote-tarjeta"
              className={`rounded-lg border p-3.5 transition-colors ${activo ? 'border-accent/60 bg-accent/[0.06]' : 'border-line bg-surface-raised hover:border-line-strong'}`}
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => onSeleccionar(activo ? null : lote.id)}
                  aria-pressed={activo}
                  className="min-w-0 flex-1 text-left"
                  title={activo ? 'Quitar el filtro' : 'Ver solo este lote en la tabla'}
                >
                  <div className="truncate font-heading text-sm text-ink-primary">{etiquetaLote(lote)}</div>
                  <div className="mt-0.5 text-xs text-ink-muted">{timeAgo(lote.created_at)}</div>
                </button>
                <button
                  type="button"
                  onClick={() => onRenombrar(lote)}
                  aria-label={`Renombrar ${etiquetaLote(lote)}`}
                  className="rounded p-1 text-ink-muted hover:bg-veil/[0.08] hover:text-ink-primary"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-3 flex items-baseline gap-2">
                <span className="num text-2xl font-semibold text-ink-primary">{items.length}</span>
                <span className="text-xs text-ink-secondary">negocios</span>
                {invitados > 0 && (
                  <span className="num ml-auto text-xs text-ink-secondary" title="De los que ya recibieron el WhatsApp, cuántos aceptaron la prueba">
                    {Math.round((aceptaron / invitados) * 100)}% aceptó
                  </span>
                )}
              </div>

              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-veil/[0.08]" role="img"
                aria-label={tramos.map((t) => `${t.n} ${t.label}`).join(', ')}>
                {tramos.map((t) => (
                  <div key={t.clave} className={t.barra} style={{ width: `${(t.n / items.length) * 100}%` }} title={`${t.n} ${t.label}`} />
                ))}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-secondary">
                {tramos.map((t) => (
                  <li key={t.clave} className="inline-flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${t.punto}`} /> <span className="num font-medium text-ink-primary">{t.n}</span> {t.label}
                  </li>
                ))}
              </ul>

              {(borradores.length > 0 || aprobados.length > 0) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {borradores.length > 0 && (
                    <Button size="sm" variant="secondary" onClick={() => onAprobar(lote, borradores)} disabled={ocupado}>
                      <CheckCheck className="h-4 w-4" /> Aprobar {borradores.length}
                    </Button>
                  )}
                  {aprobados.length > 0 && (
                    <Button size="sm" onClick={() => onWhatsApp(lote, aprobados)} disabled={ocupado || sinCupo}
                      title={sinCupo ? 'Hoy ya no quedan envíos de WhatsApp' : undefined}>
                      <MessageCircle className="h-4 w-4" /> WhatsApp {aprobados.length}
                    </Button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {conEnvios.length > VISIBLES && (
        <button type="button" onClick={() => setTodos((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-xs text-ink-secondary hover:text-ink-primary">
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${todos ? 'rotate-180' : ''}`} />
          {todos ? 'Mostrar menos' : `Ver los ${conEnvios.length - VISIBLES} lotes anteriores`}
        </button>
      )}
      {sinLote > 0 && <p className="mt-2 text-xs text-ink-muted">{sinLote} envío(s) sin lote (anteriores a los lotes).</p>}
    </section>
  );
}
