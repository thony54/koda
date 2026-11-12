import { Loader2, Pencil, RefreshCw, Send, Sparkles, UserRound, X } from 'lucide-react';
import type { BorradorAgente } from '@/lib/data/agente';

const INTENCION: Record<string, string> = {
  precio: 'Precio', pagina_web: 'Página web', redes: 'Redes sociales', como_funciona: 'Cómo funciona', prueba: 'Prueba gratis', demo: 'La demo',
  objecion: 'Objeción', interes: 'Interés', soporte: 'Soporte', agradecimiento: 'Agradece', rechazo: 'No le interesa', queja: 'Queja',
  baja: 'Pidió baja', bot: 'Preguntó si es una persona', saludo: 'Saludo', acuse: 'Acuse de recibo', aprendida: 'Aprendida de ti',
};

interface Props {
  borrador: BorradorAgente;
  /** Pidiendo «otra versión». */
  generando: boolean;
  /** Enviando este borrador ahora mismo. */
  enviando: boolean;
  onEnviar: () => void;
  onEditar: () => void;
  onOtra: () => void;
  onDescartar: () => void;
}

const boton = 'inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-secondary hover:bg-veil/[0.06] hover:text-ink-primary disabled:opacity-60 disabled:hover:bg-transparent';

/** El borrador que dejó el agente en este chat: se envía tal cual, se edita, se pide otra versión o se descarta. */
export function BorradorAgenteCard({ borrador: b, generando, enviando, onEnviar, onEditar, onOtra, onDescartar }: Props) {
  const intencion = b.intencion ? INTENCION[b.intencion] : null;

  if (b.accion === 'traspasar') {
    return (
      <div className="border-t border-warning/30 bg-warning/[0.07] px-3 py-2.5 sm:px-4" role="status" aria-label="El agente te deja este mensaje a ti">
        <div className="flex items-start gap-2.5">
          <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium text-warning">Te lo dejo a ti{intencion ? ` · ${intencion}` : ''}</p>
            <p className="mt-0.5 break-words text-[13px] text-ink-primary">{b.nota || 'El agente prefiere que respondas tú.'}</p>
            <p className="mt-0.5 text-[11.5px] text-ink-muted">Cuando lo respondas, el agente lo aprende para la próxima.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={onOtra} disabled={generando} className={boton}>
                {generando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Pedirle un borrador igual
              </button>
              <button onClick={onDescartar} className={boton}><X className="h-3.5 w-3.5" /> Entendido</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-accent/25 bg-accent/[0.06] px-3 py-2.5 sm:px-4" role="region" aria-label="Borrador del agente">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <Sparkles className="h-3.5 w-3.5 text-accent-text" />
        <span className="font-medium text-accent-text">Borrador del agente</span>
        {intencion && <span className="rounded-full border border-line px-2 py-px text-[11px] text-ink-secondary">{intencion}</span>}
        {b.confianza === 'baja' && <span className="rounded-full border border-warning/40 px-2 py-px text-[11px] text-warning">Revísalo bien</span>}
      </div>
      <p className="whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-base/70 px-3 py-2 text-[14px] leading-snug text-ink-primary">{b.texto}</p>
      {b.nota && <p className="mt-1.5 break-words text-[11.5px] text-ink-muted">{b.nota}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={onEnviar} disabled={enviando || generando} className="glass-button inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-60">
          {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Enviar así
        </button>
        <button onClick={onEditar} disabled={enviando} className={boton}><Pencil className="h-3.5 w-3.5" /> Editar</button>
        <button onClick={onOtra} disabled={enviando || generando} className={boton}>
          {generando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Otra versión
        </button>
        <button onClick={onDescartar} disabled={enviando} className={boton}><X className="h-3.5 w-3.5" /> Descartar</button>
      </div>
    </div>
  );
}
