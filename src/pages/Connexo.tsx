import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCheck, Loader2, MessageCircle, RefreshCw, Send, X } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';
import { Badge, Button, Modal, Table, THead, TBody, TR, TH, TD } from '@/components/ui';
import { RevisionModal } from '@/components/connexo/RevisionModal';
import {
  useCupoWhatsApp, useEnviarWhatsApp, useEnvios, useRefrescarConnexo, useRevisarEnvios,
} from '@/hooks/useConnexo';
import {
  ESTADO_CONNEXO, ESTADOS_PARA, PLANTILLA_CONNEXO, falloWhatsApp, type ConnexoEnvio, type ConnexoEstado,
} from '@/lib/data/connexo';
import { timeAgo } from '@/lib/format';
import { useUIStore } from '@/store/uiStore';

// Solo estos estados se pueden revisar en bloque; el resto lo maneja Connexo.
const SELECCIONABLES: ConnexoEstado[] = ['borrador', 'aprobado'];

export default function Connexo() {
  const toast = useUIStore((s) => s.toast);
  const { data, isLoading, error } = useEnvios();
  const refrescar = useRefrescarConnexo();
  const revisar = useRevisarEnvios();
  const enviarWa = useEnviarWhatsApp();
  const { data: cupo } = useCupoWhatsApp();
  const [filtro, setFiltro] = useState<ConnexoEstado | 'todos'>('todos');
  const [busqueda, setBusqueda] = useState('todas');
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [revisando, setRevisando] = useState<ConnexoEnvio | null>(null);
  const [confirmarDescarte, setConfirmarDescarte] = useState(false);
  const [confirmarWa, setConfirmarWa] = useState(false);

  const envios = data ?? [];

  // Al abrir la pantalla se traen en silencio los estados de Connexo: así ves de inmediato quién aceptó
  // el WhatsApp o pidió no ser contactado, sin tener que pulsar «Actualizar estados».
  const sincronizado = useRef(false);
  useEffect(() => {
    if (sincronizado.current || !data?.length) return;
    sincronizado.current = true;
    if (data.some((e) => e.estado === 'wa_enviado' || e.estado === 'aprobado')) refrescar.mutate();
  }, [data, refrescar]);
  const conteo = useMemo(() => {
    const c: Partial<Record<ConnexoEstado, number>> = {};
    for (const e of envios) c[e.estado] = (c[e.estado] ?? 0) + 1;
    return c;
  }, [envios]);
  const busquedas = useMemo(
    () => [...new Set(envios.map((e) => e.busqueda_nombre).filter((x): x is string => !!x))].sort(),
    [envios],
  );
  const visibles = envios.filter(
    (e) => (filtro === 'todos' || e.estado === filtro) && (busqueda === 'todas' || e.busqueda_nombre === busqueda),
  );
  const seleccionables = visibles.filter((e) => SELECCIONABLES.includes(e.estado));
  const elegidos = envios.filter((e) => seleccion.has(e.id));
  const aprobables = elegidos.filter((e) => ESTADOS_PARA.aprobar.includes(e.estado));
  const descartables = elegidos.filter((e) => ESTADOS_PARA.descartar.includes(e.estado));
  const paraWhatsApp = elegidos.filter((e) => ESTADOS_PARA.whatsapp.includes(e.estado));
  const hayCupo = cupo?.configurado && cupo.disponibles != null;
  const todosMarcados = seleccionables.length > 0 && seleccionables.every((e) => seleccion.has(e.id));

  function alternar(id: string) {
    setSeleccion((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function alternarTodos() {
    setSeleccion(todosMarcados ? new Set() : new Set(seleccionables.map((e) => e.id)));
  }

  async function actualizar() {
    try {
      const r = await refrescar.mutateAsync();
      if (!r.configurado) toast('El puente con Connexo todavía no está configurado.', 'error');
      else toast(r.actualizados ? `${r.actualizados} envío(s) actualizados` : 'Todo está al día', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo consultar a Connexo.', 'error');
    }
  }

  async function enBloque(paso: 'aprobar' | 'descartar', lista: ConnexoEnvio[]) {
    try {
      const r = await revisar.mutateAsync({ ids: lista.map((e) => e.id), paso });
      const ok = r.resultados.filter((x) => x.ok).length;
      const fallos = r.resultados.filter((x) => !x.ok);
      const verbo = paso === 'aprobar' ? 'aprobado(s)' : 'descartado(s)';
      if (fallos.length) toast(`${ok} ${verbo}. ${fallos.length} con error: ${fallos[0].error ?? 'sin detalle'}`, ok ? 'info' : 'error');
      else toast(`${ok} ${verbo}`, 'success');
      setSeleccion(new Set());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo completar.', 'error');
    } finally {
      setConfirmarDescarte(false);
    }
  }

  async function mandarWhatsApp(lista: ConnexoEnvio[]) {
    try {
      const r = await enviarWa.mutateAsync(lista.map((e) => e.id));
      const fallos = r.resultados.filter((x) => x.resultado === 'error');
      const sinCupo = r.resultados.filter((x) => x.resultado === 'omitido' && /Sin cupo/.test(x.motivo ?? '')).length;
      const partes = [`${r.enviados} WhatsApp enviado(s)`];
      if (sinCupo) partes.push(`${sinCupo} quedan para mañana (tope diario)`);
      if (fallos.length) partes.push(`${fallos.length} con error: ${fallos[0].motivo ?? 'sin detalle'}`);
      toast(partes.join(' · '), fallos.length ? (r.enviados ? 'info' : 'error') : 'success');
      setSeleccion(new Set());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo enviar por WhatsApp.', 'error');
    } finally {
      setConfirmarWa(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Puente"
        title="Connexo"
        description="Prospectos que enviaste a Connexo Clients. Revisa el perfil que armó de cada uno, apruébalo y luego invítalo por WhatsApp."
        actions={
          <div className="flex items-center gap-2">
            {hayCupo && (
              <span
                className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-ink-secondary"
                title="Saludos por WhatsApp enviados en las últimas 24 horas. Meta limita las conversaciones que una empresa inicia por día."
              >
                <MessageCircle className="h-3.5 w-3.5" /> Hoy {cupo.usados}/{cupo.limite}
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={actualizar} loading={refrescar.isPending}>
              <RefreshCw className="h-4 w-4" /> Actualizar estados
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="grid place-items-center py-20 text-ink-muted"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : error ? (
        <EmptyState icon={<Send className="h-6 w-6" />} title="No se pudo cargar" hint={(error as Error).message} />
      ) : envios.length === 0 ? (
        <EmptyState
          icon={<Send className="h-6 w-6" />}
          title="Aún no has enviado prospectos a Connexo"
          hint="En Prospectos, selecciona los que quieras y usa «Enviar a Connexo». Connexo arma un perfil borrador de cada uno y aquí lo verás."
          action={<Link to="/prospectos"><Button variant="secondary" size="sm">Ir a Prospectos</Button></Link>}
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
            <FiltroChip activo={filtro === 'todos'} onClick={() => setFiltro('todos')}>Todos · {envios.length}</FiltroChip>
            {(Object.keys(ESTADO_CONNEXO) as ConnexoEstado[]).filter((k) => conteo[k]).map((k) => (
              <FiltroChip key={k} activo={filtro === k} onClick={() => setFiltro(k)}>
                {ESTADO_CONNEXO[k].label} · {conteo[k]}
              </FiltroChip>
            ))}
            {busquedas.length > 0 && (
              <select
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                aria-label="Filtrar por búsqueda"
                className="ml-auto rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink-secondary"
              >
                <option value="todas">Todas las búsquedas</option>
                {busquedas.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
          </div>

          {seleccion.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
              <span className="text-ink-primary">{seleccion.size} seleccionado(s)</span>
              <Button size="sm" onClick={() => enBloque('aprobar', aprobables)} disabled={!aprobables.length} loading={revisar.isPending}>
                <CheckCheck className="h-4 w-4" /> Aprobar{aprobables.length ? ` (${aprobables.length})` : ''}
              </Button>
              <Button size="sm" onClick={() => setConfirmarWa(true)} disabled={!paraWhatsApp.length || (hayCupo && cupo.disponibles === 0)}>
                <MessageCircle className="h-4 w-4" /> Enviar por WhatsApp{paraWhatsApp.length ? ` (${paraWhatsApp.length})` : ''}
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirmarDescarte(true)} disabled={!descartables.length}>
                Descartar{descartables.length ? ` (${descartables.length})` : ''}
              </Button>
              <button className="ml-auto text-ink-muted hover:text-ink-primary" onClick={() => setSeleccion(new Set())} aria-label="Quitar selección">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <Table>
            <THead>
              <tr>
                <TH className="w-8">
                  {seleccionables.length > 0 && (
                    <input type="checkbox" checked={todosMarcados} onChange={alternarTodos} aria-label="Seleccionar los que se pueden revisar" className="accent-[var(--accent,#ff6b35)]" />
                  )}
                </TH>
                <TH>Negocio</TH>
                <TH>Plantilla</TH>
                <TH className="hidden xl:table-cell">Búsqueda</TH>
                <TH>Estado</TH>
                <TH>Enviado</TH>
                <TH><span className="sr-only">Revisar</span></TH>
              </tr>
            </THead>
            <TBody>
              {visibles.map((e) => {
                const info = ESTADO_CONNEXO[e.estado];
                const puedeSeleccionar = SELECCIONABLES.includes(e.estado);
                return (
                  <TR key={e.id}>
                    <TD>
                      {puedeSeleccionar && (
                        <input type="checkbox" checked={seleccion.has(e.id)} onChange={() => alternar(e.id)} aria-label={`Seleccionar ${e.prospect_nombre}`} className="accent-[var(--accent,#ff6b35)]" />
                      )}
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        {e.prospect_id ? (
                          <Link to={`/prospectos/${e.prospect_id}`} className="font-medium text-ink-primary hover:text-accent-text">
                            {e.prospect_nombre}
                          </Link>
                        ) : (
                          <span className="font-medium text-ink-primary">{e.prospect_nombre}</span>
                        )}
                        <Badge variant="primary">KODA</Badge>
                      </div>
                      <div className="text-xs text-ink-muted">{[e.categoria, e.prospect_ciudad].filter(Boolean).join(' · ') || '—'}</div>
                    </TD>
                    <TD className="text-ink-secondary">{e.connexo_theme ? (PLANTILLA_CONNEXO[e.connexo_theme] ?? e.connexo_theme) : '—'}</TD>
                    <TD className="hidden text-ink-secondary xl:table-cell">{e.busqueda_nombre ?? '—'}</TD>
                    <TD>
                      <span title={e.detalle ?? info.hint}><Badge variant={info.variant}>{info.label}</Badge></span>
                      {(e.estado === 'error' || falloWhatsApp(e)) && e.detalle && <div className="mt-1 max-w-xs text-xs text-danger">{e.detalle}</div>}
                    </TD>
                    <TD className="text-ink-muted">{timeAgo(e.enviado_at)}</TD>
                    <TD>
                      {e.connexo_username && (
                        <Button variant="secondary" size="sm" onClick={() => setRevisando(e)}>Revisar</Button>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {visibles.length === 0 && <p className="py-8 text-center text-sm text-ink-muted">No hay envíos con ese filtro.</p>}
        </>
      )}

      {revisando && <RevisionModal envio={revisando} onClose={() => setRevisando(null)} />}

      <Modal
        open={confirmarWa}
        onClose={() => setConfirmarWa(false)}
        size="sm"
        title="Enviar por WhatsApp"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmarWa(false)}>Cancelar</Button>
            <Button size="sm" onClick={() => mandarWhatsApp(paraWhatsApp)} loading={enviarWa.isPending}>
              <MessageCircle className="h-4 w-4" /> Enviar {Math.min(paraWhatsApp.length, hayCupo ? cupo.disponibles ?? paraWhatsApp.length : paraWhatsApp.length)}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-ink-secondary">
          <p>
            Se enviará el saludo inicial a <strong className="text-ink-primary">{paraWhatsApp.length}</strong> negocio(s) desde el WhatsApp de Connexo,
            con dos botones: «¡Sí, enviar demo!» y «Ver más tarde».
          </p>
          <p>
            Solo si tocan «¡Sí, enviar demo!», Connexo activa su perfil, empieza su prueba de 7 días y les manda su enlace con usuario y clave. Si piden
            que no les escriban, no se les vuelve a contactar.
          </p>
          {hayCupo && (
            <p className={paraWhatsApp.length > (cupo.disponibles ?? 0) ? 'text-warning' : ''}>
              Hoy quedan <strong>{cupo.disponibles}</strong> de {cupo.limite} envíos.
              {paraWhatsApp.length > (cupo.disponibles ?? 0) && ' Los que no quepan siguen aprobados y los envías mañana.'}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={confirmarDescarte}
        onClose={() => setConfirmarDescarte(false)}
        size="sm"
        title="Descartar negocios"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmarDescarte(false)}>Cancelar</Button>
            <Button variant="danger" size="sm" onClick={() => enBloque('descartar', descartables)} loading={revisar.isPending}>
              Descartar {descartables.length}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-secondary">
          {descartables.length} negocio(s) salen del embudo y no se les ofrecerá la plantilla. Puedes restaurarlos después.
        </p>
      </Modal>
    </div>
  );
}

function FiltroChip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 transition-colors ${
        activo ? 'border-accent/50 bg-accent/10 text-ink-primary' : 'border-line text-ink-secondary hover:text-ink-primary'
      }`}
    >
      {children}
    </button>
  );
}
