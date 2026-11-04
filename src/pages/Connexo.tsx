import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, RefreshCw, Send } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/layout/PageHeader';
import { Badge, Button, Table, THead, TBody, TR, TH, TD } from '@/components/ui';
import { useEnvios, useRefrescarConnexo } from '@/hooks/useConnexo';
import { ESTADO_CONNEXO, type ConnexoEstado } from '@/lib/data/connexo';
import { timeAgo } from '@/lib/format';
import { useUIStore } from '@/store/uiStore';

export default function Connexo() {
  const toast = useUIStore((s) => s.toast);
  const { data, isLoading, error } = useEnvios();
  const refrescar = useRefrescarConnexo();
  const [filtro, setFiltro] = useState<ConnexoEstado | 'todos'>('todos');

  const envios = data ?? [];
  const conteo = useMemo(() => {
    const c: Partial<Record<ConnexoEstado, number>> = {};
    for (const e of envios) c[e.estado] = (c[e.estado] ?? 0) + 1;
    return c;
  }, [envios]);
  const visibles = filtro === 'todos' ? envios : envios.filter((e) => e.estado === filtro);

  async function actualizar() {
    try {
      const r = await refrescar.mutateAsync();
      if (!r.configurado) toast('El puente con Connexo todavía no está configurado.', 'error');
      else toast(r.actualizados ? `${r.actualizados} envío(s) actualizados` : 'Todo está al día', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo consultar a Connexo.', 'error');
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Puente"
        title="Connexo"
        description="Prospectos que enviaste a Connexo Clients para que arme su perfil de prueba de 7 días."
        actions={
          <Button variant="secondary" size="sm" onClick={actualizar} loading={refrescar.isPending}>
            <RefreshCw className="h-4 w-4" /> Actualizar estados
          </Button>
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
          </div>

          <Table>
            <THead>
              <tr>
                <TH>Negocio</TH>
                <TH>Plantilla</TH>
                <TH>Búsqueda</TH>
                <TH>Estado</TH>
                <TH>Enviado</TH>
              </tr>
            </THead>
            <TBody>
              {visibles.map((e) => {
                const info = ESTADO_CONNEXO[e.estado];
                return (
                  <TR key={e.id}>
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
                    <TD className="text-ink-secondary">{e.connexo_theme ?? '—'}</TD>
                    <TD className="text-ink-secondary">{e.busqueda_nombre ?? '—'}</TD>
                    <TD>
                      <span title={e.detalle ?? info.hint}><Badge variant={info.variant}>{info.label}</Badge></span>
                      {e.estado === 'error' && e.detalle && <div className="mt-1 max-w-xs text-xs text-danger">{e.detalle}</div>}
                    </TD>
                    <TD className="text-ink-muted">{timeAgo(e.enviado_at)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </>
      )}
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
