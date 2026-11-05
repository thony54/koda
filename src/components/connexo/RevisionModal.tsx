import { ExternalLink, Loader2, Sparkles, UserRound } from 'lucide-react';
import { Badge, Button, Modal } from '@/components/ui';
import { useDetalleEnvio, useRevisarEnvios } from '@/hooks/useConnexo';
import {
  ESTADO_CONNEXO, PASOS_POR_ESTADO, PLANTILLA_CONNEXO, resumirRelleno,
  type ConnexoEnvio, type PasoRevision,
} from '@/lib/data/connexo';
import { useUIStore } from '@/store/uiStore';

const AVISO_PASO: Record<PasoRevision, string> = {
  aprobar: 'Aprobado: quedó listo para invitarlo por WhatsApp.',
  devolver: 'Volvió a revisión.',
  descartar: 'Descartado. Puedes restaurarlo cuando quieras.',
  restaurar: 'Restaurado: vuelve a estar por revisar.',
  rellenar: 'Contenido rehecho.',
};

/** Revisión de un negocio: vista previa de su perfil, qué trae de KODA y qué es contenido de ejemplo. */
export function RevisionModal({ envio, onClose }: { envio: ConnexoEnvio; onClose: () => void }) {
  const toast = useUIStore((s) => s.toast);
  const { data, isLoading, error } = useDetalleEnvio(envio.id);
  const revisar = useRevisarEnvios();

  const estado = data?.estado ?? envio.estado;
  const info = ESTADO_CONNEXO[estado];
  const resumen = resumirRelleno(data?.relleno ?? null);
  const pasos = PASOS_POR_ESTADO[estado] ?? [];
  const plantilla = PLANTILLA_CONNEXO[data?.theme ?? envio.connexo_theme ?? ''] ?? data?.theme ?? envio.connexo_theme ?? '—';

  async function ejecutar(paso: PasoRevision) {
    try {
      const r = await revisar.mutateAsync({ ids: [envio.id], paso });
      const x = r.resultados[0];
      if (!x?.ok) {
        toast(x?.error ?? 'Connexo no pudo hacerlo.', 'error');
        return;
      }
      toast(AVISO_PASO[paso], 'success');
      if (paso !== 'rellenar') onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo completar el paso.', 'error');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={envio.prospect_nombre}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cerrar</Button>
          {estado === 'borrador' && (
            <Button variant="secondary" size="sm" onClick={() => ejecutar('rellenar')} loading={revisar.isPending}>
              <Sparkles className="h-4 w-4" /> Rehacer contenido
            </Button>
          )}
          {pasos.map((p) => (
            <Button key={p.paso} variant={p.tono} size="sm" onClick={() => ejecutar(p.paso)} loading={revisar.isPending}>
              {p.label}
            </Button>
          ))}
        </>
      }
    >
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="primary">KODA</Badge>
          <Badge variant={info.variant}>{info.label}</Badge>
          <span className="text-ink-secondary">Plantilla: <b className="text-ink-primary">{plantilla}</b></span>
          <span className="text-ink-muted">· {[envio.categoria, envio.prospect_ciudad].filter(Boolean).join(' · ') || '—'}</span>
        </div>

        {isLoading ? (
          <div className="grid place-items-center py-10 text-ink-muted"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : error ? (
          <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-danger">{(error as Error).message}</p>
        ) : (
          <>
            <section className="rounded-lg border border-line p-4">
              <h3 className="mb-1 font-medium text-ink-primary">Vista previa</h3>
              <p className="mb-3 text-xs text-ink-muted">
                Abre el perfil tal como lo vería el negocio. Los borradores solo los muestra Connexo a una cuenta de
                administrador con la sesión iniciada.
              </p>
              {data?.preview_url ? (
                <a href={data.preview_url} target="_blank" rel="noopener noreferrer">
                  <Button variant="secondary" size="sm"><ExternalLink className="h-4 w-4" /> Ver el perfil en Connexo</Button>
                </a>
              ) : (
                <p className="text-xs text-ink-muted">Este envío todavía no tiene perfil para ver.</p>
              )}
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-line p-4">
                <h3 className="mb-2 flex items-center gap-1.5 font-medium text-ink-primary">
                  <UserRound className="h-4 w-4 text-accent-text" /> Datos de este negocio
                </h3>
                {resumen.deKoda.length ? <Lista items={resumen.deKoda} /> : <p className="text-xs text-ink-muted">Sin datos propios.</p>}
                {resumen.enlaces > 0 && <p className="mt-2 text-xs text-ink-muted">{resumen.enlaces} enlace(s) reales: WhatsApp, mapa y redes.</p>}
              </div>
              <div className="rounded-lg border border-line p-4">
                <h3 className="mb-2 flex items-center gap-1.5 font-medium text-ink-primary">
                  <Sparkles className="h-4 w-4 text-accent-text" /> Contenido de ejemplo
                </h3>
                {resumen.deEjemplo.length || resumen.tablas.length ? (
                  <>
                    <Lista items={resumen.deEjemplo} />
                    {resumen.tablas.length > 0 && <p className="mt-2 text-xs text-ink-secondary">Además: {resumen.tablas.join(', ')}.</p>}
                  </>
                ) : (
                  <p className="text-xs text-ink-muted">Sin contenido de ejemplo.</p>
                )}
              </div>
            </section>
            <p className="text-xs text-ink-muted">
              El contenido de ejemplo está ahí para que el negocio vea cómo le quedaría su perfil lleno; lo cambia por el suyo
              cuando acepta. No incluye reseñas ni testimonios inventados.
            </p>

            {data?.detalle && (
              <p className="rounded-md border border-line bg-surface-2 p-3 text-xs text-ink-secondary">{data.detalle}</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function Lista({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <span key={i} className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-secondary">{i}</span>
      ))}
    </div>
  );
}
