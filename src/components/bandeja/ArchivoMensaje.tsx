import { useEffect, useState } from 'react';
import { AlertCircle, Download, ExternalLink, FileText, Loader2, RefreshCw, X } from 'lucide-react';
import { urlArchivo, type Mensaje } from '@/lib/data/bandeja';
import { reintentarDescarga } from '@/lib/bandeja/acciones';
import { tamano } from '@/lib/bandeja/formato';

/** Enlace temporal al archivo guardado (se renueva solo antes de vencer). */
function useUrl(path: string | undefined): { url: string | null; error: boolean } {
  const [estado, setEstado] = useState<{ path?: string; url: string | null; error: boolean }>({ url: null, error: false });
  useEffect(() => {
    if (!path) return;
    let activo = true;
    urlArchivo(path)
      .then((url) => { if (activo) setEstado({ path, url, error: false }); })
      .catch(() => { if (activo) setEstado({ path, url: null, error: true }); });
    return () => { activo = false; };
  }, [path]);
  return estado.path === path ? { url: estado.url, error: estado.error } : { url: null, error: false };
}

/** Foto a pantalla completa: cierra con clic fuera o Esc; se puede abrir en otra pestaña o descargar. */
function Visor({ url, nombre, onCerrar }: { url: string; nombre: string; onCerrar: () => void }) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar]);
  const boton = 'rounded-md bg-black/55 p-2 text-white hover:bg-black/75';
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/90 p-4 backdrop-blur-sm" role="dialog" aria-modal aria-label="Foto" onClick={onCerrar}>
      <div className="absolute right-4 top-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
        <a href={url} download={nombre} className={boton} aria-label="Descargar" title="Descargar"><Download className="h-5 w-5" /></a>
        <a href={url} target="_blank" rel="noopener noreferrer" className={boton} aria-label="Abrir en una pestaña nueva" title="Abrir en una pestaña nueva"><ExternalLink className="h-5 w-5" /></a>
        <button className={boton} onClick={onCerrar} aria-label="Cerrar" title="Cerrar (Esc)"><X className="h-5 w-5" /></button>
      </div>
      <img src={url} alt="" className="max-h-full max-w-full rounded-md object-contain" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

export function ArchivoMensaje({ m }: { m: Mensaje }) {
  const media = m.media;
  const path = media?.estado === 'guardado' ? media.path : undefined;
  const { url, error } = useUrl(path);
  // Mientras se envía (o hasta que llega el enlace firmado) se usa la vista previa local: sin parpadeos.
  const src = url ?? m.localUrl ?? null;
  const [visor, setVisor] = useState(false);
  const [reintentando, setReintentando] = useState(false);
  const [falloReintento, setFalloReintento] = useState<string | null>(null);

  if (!media) return null;
  const nombre = media.nombre ?? 'archivo';

  async function reintentar() {
    setReintentando(true);
    setFalloReintento(null);
    const r = await reintentarDescarga(m);
    setReintentando(false);
    if (!r.ok) setFalloReintento(r.error ?? 'No se pudo bajar el archivo.');
  }

  // Aún bajando de Meta (llega en segundos).
  if (!src && (media.estado === 'pendiente' || (!path && media.estado !== 'error'))) {
    return (
      <div className="flex min-h-[64px] min-w-[180px] items-center gap-2 rounded-md bg-black/20 px-3 py-2 text-xs text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Descargando archivo…
      </div>
    );
  }
  if (!src && (media.estado === 'error' || error)) {
    return (
      <div className="space-y-1.5 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
        <p className="flex items-center gap-1.5"><AlertCircle className="h-4 w-4 shrink-0" /> No se pudo guardar el archivo.</p>
        {(falloReintento ?? media.error) && <p className="text-[11px] opacity-80">{falloReintento ?? media.error}</p>}
        {media.id && (
          <button onClick={() => void reintentar()} disabled={reintentando} className="inline-flex items-center gap-1 rounded border border-danger/40 px-2 py-1 font-medium hover:bg-danger/10 disabled:opacity-50">
            <RefreshCw className={`h-3 w-3 ${reintentando ? 'animate-spin' : ''}`} /> Reintentar
          </button>
        )}
      </div>
    );
  }
  if (!src) {
    return (
      <div className="flex min-h-[64px] min-w-[180px] items-center gap-2 rounded-md bg-black/20 px-3 py-2 text-xs text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Abriendo…
      </div>
    );
  }

  if (m.tipo === 'image') {
    return (
      <>
        <button onClick={() => setVisor(true)} className="block overflow-hidden rounded-md" aria-label="Ver foto en grande" title="Ver en grande">
          <img src={src} alt={m.texto ?? 'Foto'} loading="lazy" className="max-h-72 w-full max-w-[280px] bg-black/20 object-cover" />
        </button>
        {visor && <Visor url={src} nombre={nombre} onCerrar={() => setVisor(false)} />}
      </>
    );
  }
  if (m.tipo === 'sticker') return <img src={src} alt="Sticker" loading="lazy" className="h-32 w-32 object-contain" />;
  if (m.tipo === 'video') {
    return <video src={src} controls preload="metadata" className="max-h-72 w-full max-w-[300px] rounded-md bg-black" />;
  }
  if (m.tipo === 'audio') {
    return (
      <div className="min-w-[220px] max-w-[280px]">
        <audio src={src} controls preload="metadata" className="h-10 w-full" />
        <p className="mt-0.5 flex items-center justify-between gap-2 text-[10.5px] text-ink-muted">
          <span>{media.voz ? 'Mensaje de voz' : 'Audio'}{media.bytes ? ` · ${tamano(media.bytes)}` : ''}</span>
          <a href={src} download={nombre} className="inline-flex items-center gap-1 hover:text-ink-primary" title="Descargar el audio"><Download className="h-3 w-3" /> Descargar</a>
        </p>
      </div>
    );
  }
  // Documento (y cualquier otro archivo)
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" download={media.nombre ?? true}
       className="flex min-w-[200px] max-w-[300px] items-center gap-3 rounded-md bg-black/20 px-3 py-2.5 hover:bg-black/30">
      <FileText className="h-7 w-7 shrink-0 text-accent-text" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{media.nombre ?? 'Documento'}</span>
        <span className="block text-[11px] text-ink-muted">{[media.mime?.split('/')[1]?.toUpperCase(), tamano(media.bytes)].filter(Boolean).join(' · ')}</span>
      </span>
      <Download className="h-4 w-4 shrink-0 text-ink-muted" />
    </a>
  );
}
