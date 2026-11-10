import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Loader2, SendHorizontal, X } from 'lucide-react';
import { mbDe, type ArchivoListo } from '@/lib/bandeja/medios';

/**
 * Vista previa antes de enviar una foto, audio, video o documento: se ve lo que saldrá, se escribe un pie (opcional) y
 * se confirma. Enter envía; Esc cancela.
 */
export function PreviaAdjunto({ archivo, onEnviar, onCancelar }: { archivo: ArchivoListo; onEnviar: (pie: string) => void; onCancelar: () => void }) {
  const [pie, setPie] = useState('');
  const [enviado, setEnviado] = useState(false);
  const caja = useRef<HTMLTextAreaElement>(null);
  const url = useMemo(() => URL.createObjectURL(archivo.blob), [archivo.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  useEffect(() => { caja.current?.focus(); }, []);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancelar(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCancelar]);

  const llevaPie = archivo.tipo !== 'audio';
  function enviar() {
    if (enviado) return;
    setEnviado(true);
    onEnviar(pie.trim());
  }

  return (
    <div className="fixed inset-0 z-[65] grid place-items-center bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal aria-label="Enviar archivo" onClick={onCancelar}>
      <div className="glass-panel flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="font-heading text-[15px] font-semibold text-ink-primary">
            {archivo.tipo === 'image' ? 'Enviar foto' : archivo.tipo === 'video' ? 'Enviar video' : archivo.tipo === 'audio' ? (archivo.voz ? 'Enviar nota de voz' : 'Enviar audio') : 'Enviar documento'}
          </h3>
          <button onClick={onCancelar} className="rounded p-1 text-ink-muted hover:bg-veil/[0.08] hover:text-ink-primary" aria-label="Cancelar"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid min-h-[140px] flex-1 place-items-center overflow-auto bg-black/30 p-3">
          {archivo.tipo === 'image' && <img src={url} alt="Vista previa" className="max-h-[48vh] max-w-full rounded-md object-contain" />}
          {archivo.tipo === 'video' && <video src={url} controls preload="metadata" className="max-h-[48vh] max-w-full rounded-md bg-black" />}
          {archivo.tipo === 'audio' && <audio src={url} controls preload="metadata" className="w-full" />}
          {archivo.tipo === 'document' && (
            <div className="flex items-center gap-3 rounded-md bg-surface-elevated px-4 py-3">
              <FileText className="h-8 w-8 text-accent-text" />
              <div className="min-w-0"><p className="truncate text-[14px] font-medium text-ink-primary">{archivo.nombre}</p><p className="text-[12px] text-ink-muted">{mbDe(archivo.bytes)}</p></div>
            </div>
          )}
        </div>

        <div className="space-y-2.5 border-t border-line p-3">
          {llevaPie && (
            <textarea
              ref={caja}
              value={pie}
              onChange={(e) => setPie(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(); } }}
              rows={2}
              maxLength={1024}
              placeholder="Añade un mensaje (opcional)"
              aria-label="Pie del archivo"
              className="glass-input w-full resize-none rounded-lg px-3 py-2 text-[14px] text-ink-primary outline-none placeholder:text-ink-muted"
            />
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[11.5px] text-ink-muted">{archivo.nombre} · {mbDe(archivo.bytes)}</p>
            <div className="flex shrink-0 gap-2">
              <button onClick={onCancelar} className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-veil/[0.06]">Cancelar</button>
              <button onClick={enviar} disabled={enviado} className="glass-button inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-[13px] font-semibold disabled:opacity-60">
                {enviado ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />} Enviar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
