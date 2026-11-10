import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Lock, Mic, Paperclip, SendHorizontal, Trash2, X } from 'lucide-react';
import type { Mensaje } from '@/lib/data/bandeja';
import type { ResultadoEnvio } from '@/lib/bandeja/acciones';
import { iniciarGrabacion, MAX_GRABACION_SEG, type ArchivoListo, type Grabacion } from '@/lib/bandeja/medios';
import { resumenMensaje } from './Burbuja';

const MAX = 4096;
const BORRADORES = new Map<string, string>();      // lo escrito y no enviado, por chat
const ACEPTA = 'image/*,video/mp4,video/3gpp,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt';

interface Props {
  convId: string;
  /** Texto de por qué no se puede escribir (ventana cerrada…); null = se puede. */
  bloqueo: string | null;
  /** Tiempo que queda de la ventana de 24 h (texto ya formateado). */
  restante: string | null;
  citando: Mensaje | null;
  onQuitarCita: () => void;
  onEnviar: (texto: string, respondeA: string | null) => Promise<ResultadoEnvio>;
  /** «Intentar responder igual» está activado: se escribe aunque la bandeja crea la ventana cerrada (Meta decide). */
  forzado: boolean;
  onForzar: (valor: boolean) => void;
  /** Se eligió, pegó o arrastró un archivo: la pantalla lo valida y muestra la vista previa. */
  onArchivo: (file: File) => void;
  /** Terminó una nota de voz: se envía al instante (como en WhatsApp). */
  onNotaDeVoz: (a: ArchivoListo) => void;
}

const mmss = (seg: number) => `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;

export function Compositor({ convId, bloqueo, restante, citando, onQuitarCita, onEnviar, forzado, onForzar, onArchivo, onNotaDeVoz }: Props) {
  const [texto, setTexto] = useState(() => BORRADORES.get(convId) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [grab, setGrab] = useState<{ g: Grabacion; seg: number } | null>(null);
  const [procesando, setProcesando] = useState(false);
  const caja = useRef<HTMLTextAreaElement>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const grabRef = useRef<Grabacion | null>(null);

  // Crece con el texto, hasta 6 líneas.
  useLayoutEffect(() => {
    const el = caja.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [texto]);

  // Al elegir «responder» a un mensaje, el cursor va a la caja.
  useEffect(() => { if (citando) caja.current?.focus(); }, [citando]);

  // Si se sale del chat grabando, se suelta el micrófono (nada queda escuchando).
  useEffect(() => () => { grabRef.current?.cancelar(); grabRef.current = null; }, []);

  // Cronómetro de la grabación; al llegar al máximo se envía sola.
  useEffect(() => {
    if (!grab) return;
    const t = window.setInterval(() => {
      const seg = Math.floor((Date.now() - grab.g.inicio) / 1000);
      setGrab((x) => (x ? { ...x, seg } : x));
      if (seg >= MAX_GRABACION_SEG) void terminarGrabacion();
    }, 250);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grab?.g]);

  function cambiar(v: string) {
    setTexto(v);
    setError(null);
    if (v) BORRADORES.set(convId, v); else BORRADORES.delete(convId);
  }

  async function enviar() {
    const limpio = texto.trim();
    if (!limpio || (bloqueo && !forzado)) return;
    if (limpio.length > MAX) { setError(`El mensaje supera los ${MAX} caracteres de WhatsApp.`); return; }
    const respondeA = citando?.wamid ?? null;
    cambiar('');
    onQuitarCita();
    const r = await onEnviar(limpio, respondeA);
    // Si el servidor lo rechazó (ventana cerrada, baja…) el texto vuelve a la caja para no perderlo.
    if (r.rechazado) {
      setError(r.error ?? 'No se pudo enviar.');
      setTexto((actual) => {
        const nuevo = actual.trim() ? `${limpio}\n${actual}` : limpio;
        BORRADORES.set(convId, nuevo);
        return nuevo;
      });
    } else if (!r.ok && r.incierto) {
      setError(r.error ?? 'No se pudo confirmar el envío.');
    }
  }

  async function empezarGrabacion() {
    setError(null);
    try {
      const g = await iniciarGrabacion();
      grabRef.current = g;
      setGrab({ g, seg: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pude grabar.');
    }
  }
  function cancelarGrabacion() {
    grabRef.current?.cancelar();
    grabRef.current = null;
    setGrab(null);
  }
  async function terminarGrabacion() {
    const g = grabRef.current;
    if (!g) return;
    grabRef.current = null;
    setGrab(null);
    setProcesando(true);
    try { onNotaDeVoz(await g.parar()); }
    catch (e) { setError(e instanceof Error ? e.message : 'No pude procesar la nota de voz.'); }
    finally { setProcesando(false); }
  }

  function alElegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';                                  // permite elegir el mismo archivo otra vez
    if (f) onArchivo(f);
  }
  function alPegar(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const f = Array.from(e.clipboardData.files)[0];
    if (f) { e.preventDefault(); onArchivo(f); }          // captura de pantalla, foto o archivo copiado
  }

  if (bloqueo && !forzado) {
    return (
      <div className="space-y-2.5 border-t border-line bg-surface-base/60 px-4 py-3.5 text-[13px] text-ink-secondary">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>{bloqueo}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 pl-7">
          <button onClick={() => onForzar(true)} className="rounded-md border border-line-strong bg-surface-elevated/60 px-3 py-1.5 text-[12.5px] font-medium text-ink-primary hover:border-accent/45 hover:bg-surface-elevated">
            Intentar responder igual
          </button>
          <span className="text-[11.5px] text-ink-muted">Úsalo si el negocio te escribió hace poco y la bandeja aún no lo sabe. Meta decide: si ya pasaron 24 h, lo rechaza y no se envía.</span>
        </div>
      </div>
    );
  }

  const cerca = texto.length > MAX - 400;
  const hayTexto = texto.trim().length > 0;
  return (
    <div className="border-t border-line bg-surface-base/60 px-3 pb-3 pt-2 sm:px-4">
      {citando && (
        <div className="mb-2 flex items-start gap-2 rounded-md border-l-2 border-accent bg-surface-elevated px-3 py-1.5 text-[12px]">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-accent-text">Respondiendo a {citando.direccion === 'saliente' ? 'tu mensaje' : 'este mensaje'}</p>
            <p className="line-clamp-1 break-words text-ink-secondary">{resumenMensaje(citando)}</p>
          </div>
          <button onClick={onQuitarCita} aria-label="Quitar cita" className="rounded p-0.5 text-ink-muted hover:bg-veil/[0.08] hover:text-ink-primary"><X className="h-4 w-4" /></button>
        </div>
      )}
      {bloqueo && forzado && (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-1.5 text-[12px] text-warning">
          <span className="min-w-0 flex-1">Intento de respuesta: no sé si su ventana de 24 h sigue abierta. Si Meta la rechaza, verás el motivo en el mensaje.</span>
          <button onClick={() => onForzar(false)} className="shrink-0 font-medium underline underline-offset-2 hover:no-underline">Cancelar</button>
        </div>
      )}
      {error && <p role="alert" className="mb-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-1.5 text-[12.5px] text-danger">{error}</p>}

      {grab ? (
        <div className="flex items-center gap-3" role="status" aria-label="Grabando nota de voz">
          <button onClick={cancelarGrabacion} aria-label="Cancelar la grabación" title="Descartar" className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border border-line text-ink-secondary hover:bg-danger/10 hover:text-danger">
            <Trash2 className="h-[18px] w-[18px]" />
          </button>
          <div className="flex h-[42px] min-w-0 flex-1 items-center gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4">
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-danger" />
            <span className="text-[14px] font-medium tabular-nums text-ink-primary">{mmss(grab.seg)}</span>
            <span className="truncate text-[12px] text-ink-muted">Grabando… pulsa enviar para mandarla</span>
          </div>
          <button onClick={() => void terminarGrabacion()} aria-label="Enviar la nota de voz" className="glass-button grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl">
            <SendHorizontal className="h-[18px] w-[18px]" />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <input ref={archivo} type="file" accept={ACEPTA} className="hidden" onChange={alElegirArchivo} aria-label="Elegir archivo" />
          <button onClick={() => archivo.current?.click()} aria-label="Adjuntar foto, video, audio o documento" title="Adjuntar (también puedes pegar una captura con Ctrl+V o arrastrar un archivo)" className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border border-line text-ink-secondary hover:bg-veil/[0.06] hover:text-ink-primary">
            <Paperclip className="h-[18px] w-[18px]" />
          </button>
          <textarea
            ref={caja}
            value={texto}
            rows={1}
            maxLength={MAX + 200}
            placeholder="Escribe un mensaje"
            aria-label="Mensaje"
            onChange={(e) => cambiar(e.target.value)}
            onPaste={alPegar}
            onKeyDown={(e) => {
              // Enter envía; Mayús+Enter es salto de línea. No interfiere con la composición de acentos/IME.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void enviar(); }
            }}
            className="glass-input max-h-[150px] min-h-[42px] flex-1 resize-none rounded-xl px-3.5 py-2.5 text-[14px] leading-snug text-ink-primary outline-none placeholder:text-ink-muted"
          />
          {hayTexto ? (
            <button onClick={() => void enviar()} aria-label="Enviar" className="glass-button grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl">
              <SendHorizontal className="h-[18px] w-[18px]" />
            </button>
          ) : (
            <button onClick={() => void empezarGrabacion()} disabled={procesando} aria-label="Grabar una nota de voz" title="Grabar una nota de voz" className="glass-button grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl disabled:opacity-60">
              <Mic className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between gap-3 px-1 text-[11px] text-ink-muted">
        <span>{restante ? `Puedes responder durante ${restante} más` : ''}</span>
        <span className={cerca ? (texto.length > MAX ? 'text-danger' : 'text-warning') : 'hidden shrink-0 min-[1280px]:inline'}>
          {cerca ? `${texto.length}/${MAX}` : procesando ? 'Preparando la nota de voz…' : 'Enter envía · Mayús+Enter salto de línea · Ctrl+V pega capturas'}
        </span>
      </div>
    </div>
  );
}
