import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronDown, ChevronRight, Layers, Loader2, Send, ShieldCheck } from 'lucide-react';
import { Badge, Button, Input, Modal } from '@/components/ui';
import { useEnviarAConnexo, useLotes, useVistaPreviaLote } from '@/hooks/useConnexo';
import { RUBRO_LABEL } from '@/lib/rubros';
import {
  TITULO_OMISION, etiquetaLote, type CodigoOmision, type LoteCreado, type ResultadoEnvio,
} from '@/lib/data/connexo';

type Fase = 'armar' | 'enviando' | 'listo';

interface Props {
  open: boolean;
  /** Prospectos que elegiste en la lista. */
  ids: string[];
  /** Se llama al cerrar. `huboEnvios` = al menos uno salió: quien abrió el modal limpia la selección. */
  onClose: (huboEnvios: boolean) => void;
}

/**
 * Arma un LOTE para Connexo: antes de enviar muestra cuántos saldrían, de qué plantilla (rubro) y por qué se omite
 * el resto (ya enviados, celular repetido, sin celular…), y recién entonces los manda juntos, agrupados en un solo lote
 * que Connexo recibe con el mismo número y nombre.
 */
export function NuevoLoteModal({ open, ids, onClose }: Props) {
  const [fase, setFase] = useState<Fase>('armar');
  const [nombre, setNombre] = useState('');
  const [progreso, setProgreso] = useState({ hechos: 0, total: 0 });
  const [resultado, setResultado] = useState<{ enviados: number; resultados: ResultadoEnvio[]; lote: LoteCreado | null } | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const { data: lotes } = useLotes(open);
  const vista = useVistaPreviaLote(ids, open && fase === 'armar');
  const enviar = useEnviarAConnexo();

  const siguiente = (lotes ?? []).reduce((m, l) => Math.max(m, l.numero), 0) + 1;
  const resultados = vista.data ?? [];
  const listos = useMemo(() => resultados.filter((r) => r.resultado === 'listo'), [resultados]);
  const omitidos = useMemo(() => resultados.filter((r) => r.resultado === 'omitido'), [resultados]);

  const porPlantilla = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of listos) m.set(r.rubro ?? 'sin_rubro', (m.get(r.rubro ?? 'sin_rubro') ?? 0) + 1);
    return [...m.entries()]
      .map(([rubro, n]) => ({ rubro, n, label: RUBRO_LABEL[rubro] ?? rubro }))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  }, [listos]);

  const porMotivo = useMemo(() => {
    const m = new Map<CodigoOmision, ResultadoEnvio[]>();
    for (const r of omitidos) m.set(r.codigo ?? 'ya_enviado', [...(m.get(r.codigo ?? 'ya_enviado') ?? []), r]);
    return [...m.entries()].map(([codigo, items]) => ({ codigo, items })).sort((a, b) => b.items.length - a.items.length);
  }, [omitidos]);

  const tandas = Math.ceil(listos.length / 25);

  function alternar(codigo: string) {
    setAbiertos((s) => { const n = new Set(s); if (n.has(codigo)) n.delete(codigo); else n.add(codigo); return n; });
  }

  async function crearYEnviar() {
    setErrorEnvio(null);
    setFase('enviando');
    setProgreso({ hechos: 0, total: listos.length });
    try {
      const r = await enviar.mutateAsync({
        ids: listos.map((l) => l.prospect_id),
        nombre: nombre.trim() || undefined,
        onProgreso: (hechos, total) => setProgreso({ hechos, total }),
      });
      setResultado(r);
      setFase('listo');
    } catch (e) {
      setErrorEnvio(e instanceof Error ? e.message : 'No se pudo enviar el lote.');
      setFase('listo');
    }
  }

  function cerrar() {
    if (fase === 'enviando') return;
    onClose((resultado?.enviados ?? 0) > 0);
  }

  const enviadosOk = (resultado?.resultados ?? []).filter((r) => r.resultado === 'enviado');
  const noSalieron = (resultado?.resultados ?? []).filter((r) => r.resultado !== 'enviado');

  return (
    <Modal
      open={open}
      onClose={cerrar}
      size="lg"
      title="Armar lote para Connexo"
      footer={
        fase === 'armar' ? (
          <>
            <Button variant="ghost" size="sm" onClick={cerrar}>Cancelar</Button>
            <Button size="sm" onClick={crearYEnviar} disabled={!listos.length || vista.isLoading} loading={enviar.isPending}>
              <Send className="h-4 w-4" /> Crear lote y enviar {listos.length || ''}
            </Button>
          </>
        ) : fase === 'enviando' ? (
          <Button size="sm" disabled loading><Send className="h-4 w-4" /> Enviando…</Button>
        ) : (
          <>
            {resultado?.lote && (
              <Link to={`/connexo?lote=${resultado.lote.id}`}>
                <Button variant="secondary" size="sm"><Layers className="h-4 w-4" /> Ver el lote en Connexo</Button>
              </Link>
            )}
            <Button size="sm" onClick={cerrar}>Listo</Button>
          </>
        )
      }
    >
      {fase === 'armar' && (
        <div className="space-y-5 text-sm">
          <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-inset p-3.5 text-ink-secondary">
            <Layers className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" />
            <p>
              Los {ids.length} prospecto(s) que elegiste viajan <strong className="text-ink-primary">juntos en un lote</strong>:
              Connexo los recibe agrupados con el mismo número y nombre. No se envía ningún WhatsApp ahora; primero revisas y apruebas cada plantilla.
            </p>
          </div>

          <div className="max-w-sm">
            <Input
              id="nombre-lote"
              label="Nombre del lote (opcional)"
              placeholder={`Lote ${siguiente}`}
              value={nombre}
              maxLength={80}
              onChange={(e) => setNombre(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-ink-muted">
              Se llamará <strong className="text-ink-secondary">{etiquetaLote({ numero: siguiente, nombre: nombre.trim() || null })}</strong>.
            </p>
          </div>

          {vista.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" /> Revisando uno por uno…</div>
          ) : vista.error ? (
            <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-danger">{(vista.error as Error).message}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-success/30 bg-success/5 p-4">
                  <div className="num text-3xl font-semibold text-success">{listos.length}</div>
                  <div className="text-xs text-ink-secondary">listos para el lote</div>
                </div>
                <div className={`rounded-lg border p-4 ${omitidos.length ? 'border-warning/30 bg-warning/5' : 'border-line'}`}>
                  <div className={`num text-3xl font-semibold ${omitidos.length ? 'text-warning' : 'text-ink-muted'}`}>{omitidos.length}</div>
                  <div className="text-xs text-ink-secondary">se omiten (no se les escribe)</div>
                </div>
              </div>

              {porPlantilla.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">Plantillas del lote</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {porPlantilla.map((p) => (
                      <span key={p.rubro} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-inset px-2.5 py-1 text-xs text-ink-secondary">
                        {p.label} <span className="num font-semibold text-ink-primary">{p.n}</span>
                      </span>
                    ))}
                  </div>
                  {tandas > 1 && (
                    <p className="mt-2 text-xs text-ink-muted">Se envían en {tandas} tandas de 25; todos quedan en el mismo lote.</p>
                  )}
                </section>
              )}

              {porMotivo.length > 0 && (
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
                    <ShieldCheck className="h-3.5 w-3.5" /> Se omiten para no repetir mensajes
                  </h3>
                  <ul className="divide-y divide-line rounded-lg border border-line">
                    {porMotivo.map(({ codigo, items }) => {
                      const abierto = abiertos.has(codigo);
                      return (
                        <li key={codigo}>
                          <button
                            type="button"
                            onClick={() => alternar(codigo)}
                            aria-expanded={abierto}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-veil/[0.04]"
                          >
                            {abierto ? <ChevronDown className="h-4 w-4 text-ink-muted" /> : <ChevronRight className="h-4 w-4 text-ink-muted" />}
                            <span className="num w-6 text-right font-semibold text-ink-primary">{items.length}</span>
                            <span className="text-ink-secondary">{TITULO_OMISION[codigo] ?? codigo}</span>
                          </button>
                          {abierto && (
                            <ul className="space-y-1 border-t border-line bg-surface-inset px-4 py-2 text-xs">
                              {items.map((r) => (
                                <li key={r.prospect_id} className="text-ink-secondary">
                                  <strong className="text-ink-primary">{r.nombre ?? r.prospect_id}</strong> — {r.motivo}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {!listos.length && (
                <p className="rounded-md border border-line bg-surface-inset p-3 text-ink-secondary">
                  Ninguno de los que elegiste se puede enviar. Cierra esto y elige otros (el filtro «Para Connexo» te muestra solo los que aún no se han enviado).
                </p>
              )}
            </>
          )}
        </div>
      )}

      {fase === 'enviando' && (
        <div className="space-y-4 py-6 text-sm">
          <div className="flex items-center gap-2 text-ink-primary"><Loader2 className="h-4 w-4 animate-spin" /> Enviando el lote a Connexo…</div>
          <div className="h-2 overflow-hidden rounded-full bg-veil/[0.08]" role="progressbar" aria-valuemin={0} aria-valuemax={progreso.total} aria-valuenow={progreso.hechos}>
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progreso.total ? Math.round((progreso.hechos / progreso.total) * 100) : 0}%` }} />
          </div>
          <p className="num text-xs text-ink-muted">{progreso.hechos} de {progreso.total}</p>
        </div>
      )}

      {fase === 'listo' && (
        <div className="space-y-4 text-sm">
          {errorEnvio ? (
            <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-danger">{errorEnvio}</p>
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/5 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              <div>
                <p className="text-ink-primary">
                  {resultado?.lote ? <strong>{etiquetaLote(resultado.lote)}</strong> : 'Lote'}: <span className="num font-semibold">{enviadosOk.length}</span> de {resultado?.resultados.length ?? 0} enviado(s) a Connexo.
                </p>
                <p className="mt-1 text-xs text-ink-secondary">Ahora revisa sus perfiles en Connexo, apruébalos y recién entonces invítalos por WhatsApp.</p>
              </div>
            </div>
          )}
          {noSalieron.length > 0 && (
            <ul className="space-y-1.5">
              {noSalieron.map((r) => (
                <li key={r.prospect_id} className="flex items-start gap-2 text-xs text-ink-secondary">
                  <Badge variant={r.resultado === 'error' ? 'error' : 'default'}>{r.resultado === 'error' ? 'Error' : 'Omitido'}</Badge>
                  <span><strong className="text-ink-primary">{r.nombre ?? r.prospect_id}</strong> — {r.motivo}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
