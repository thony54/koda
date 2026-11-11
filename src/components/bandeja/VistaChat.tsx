import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowDown, ArrowLeft, Bot, BotOff, Loader2, Mail, PanelRight, RefreshCw, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui';
import { ESTADO_CONNEXO, type ConnexoEstado } from '@/lib/data/connexo';
import type { Conversacion, Mensaje } from '@/lib/data/bandeja';
import { useBandejaStore } from '@/store/bandejaStore';
import {
  abrirHilo, archivar, cargarAnteriores, enviarArchivo, enviarTexto, marcarComoLeida, marcarComoNoLeida, reintentarEnvio,
} from '@/lib/bandeja/acciones';
import { prepararArchivo, type ArchivoListo } from '@/lib/bandeja/medios';
import { cargarAgente, descartarBorrador, otraVersion, pausarEnChat } from '@/lib/bandeja/agenteAcciones';
import { useAgenteStore } from '@/store/agenteStore';
import { etiquetaDia } from '@/lib/bandeja/formato';
import { armarHilo, separarReacciones, textoRestante, tituloConversacion, ventana } from '@/lib/bandeja/orden';
import { formatPhoneEC } from '@/lib/format';
import { useUIStore } from '@/store/uiStore';
import { Avatar } from './piezas';
import { Burbuja } from './Burbuja';
import { Compositor } from './Compositor';
import { BorradorAgenteCard } from './BorradorAgente';
import { PreviaAdjunto } from './PreviaAdjunto';

const CERCA_DEL_FONDO_PX = 120;

/** ¿La pestaña está a la vista y con el foco? Solo entonces un mensaje cuenta como leído. */
function usePestanaActiva(): boolean {
  const [activa, setActiva] = useState(() => document.visibilityState === 'visible' && document.hasFocus());
  useEffect(() => {
    const f = () => setActiva(document.visibilityState === 'visible' && document.hasFocus());
    window.addEventListener('focus', f);
    window.addEventListener('blur', f);
    document.addEventListener('visibilitychange', f);
    return () => { window.removeEventListener('focus', f); window.removeEventListener('blur', f); document.removeEventListener('visibilitychange', f); };
  }, []);
  return activa;
}

/** Hora actual que se refresca cada `ms` (para la cuenta atrás de la ventana de 24 h y los «sin confirmar»). */
function useAhora(ms: number): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setAhora(Date.now()), ms); return () => window.clearInterval(t); }, [ms]);
  return ahora;
}

export function VistaChat({ conv, onVolver, panelAbierto, onPanel }: { conv: Conversacion; onVolver: () => void; panelAbierto: boolean; onPanel: () => void }) {
  const toast = useUIStore((s) => s.toast);
  const hilo = useBandejaStore((s) => s.hilos[conv.id]);
  const activa = usePestanaActiva();
  const ahora = useAhora(15_000);
  const [citando, setCitando] = useState<Mensaje | null>(null);
  const [nuevos, setNuevos] = useState(0);
  const [forzado, setForzado] = useState(false);
  const [adjunto, setAdjunto] = useState<ArchivoListo | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  // Agente de respuestas (migración 0017)
  const borrador = useAgenteStore((s) => s.borradores[conv.id]);
  const generando = useAgenteStore((s) => !!s.generando[conv.id]);
  const modoAgente = useAgenteStore((s) => s.config?.modo);
  const [sugerencia, setSugerencia] = useState<{ clave: number; id: string; texto: string } | null>(null);
  const [enviandoBorrador, setEnviandoBorrador] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);
  const alFondo = useRef(true);
  const previo = useRef<{ primero: string | null; ultimo: string | null; alto: number; top: number; n: number }>({ primero: null, ultimo: null, alto: 0, top: 0, n: 0 });

  const titulo = tituloConversacion(conv);
  const mensajes = hilo?.mensajes;
  const cargado = hilo?.cargado ?? false;

  // Al abrir el chat se piden sus mensajes (una vez; después se mantiene al día en vivo).
  useEffect(() => { void abrirHilo(conv.id); }, [conv.id]);

  // Leído: solo si el chat está abierto Y la pestaña a la vista y con foco.
  useEffect(() => {
    if (activa && conv.no_leidos > 0) void marcarComoLeida(conv.id);
  }, [activa, conv.no_leidos, conv.id]);

  const { visibles, reacciones } = useMemo(() => separarReacciones(mensajes ?? []), [mensajes]);
  const items = useMemo(() => armarHilo(visibles), [visibles]);
  const porWamid = useMemo(() => new Map(visibles.filter((m) => m.wamid).map((m) => [m.wamid as string, m])), [visibles]);

  // ── Desplazamiento ──
  const alFinal = useCallback((suave: boolean) => {
    const el = contenedor.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: suave ? 'smooth' : 'auto' });
  }, []);

  useLayoutEffect(() => {
    const el = contenedor.current;
    if (!el || !mensajes) return;
    const p = previo.current;
    const primero = mensajes[0]?.id ?? null;
    const ultimo = mensajes[mensajes.length - 1]?.id ?? null;
    if (p.n === 0 && mensajes.length > 0) {
      el.scrollTop = el.scrollHeight;                                   // primera carga: al final, sin animación
      alFondo.current = true;
    } else if (primero !== p.primero && ultimo === p.ultimo) {
      el.scrollTop = el.scrollHeight - p.alto + p.top;                  // llegaron mensajes ANTERIORES: no se mueve lo que se estaba leyendo
    } else if (ultimo !== p.ultimo) {
      const nuevo = mensajes[mensajes.length - 1];
      if (alFondo.current || nuevo.direccion === 'saliente') alFinal(true);
      else {
        const entrantes = mensajes.slice(p.n > 0 ? Math.max(0, mensajes.findIndex((m) => m.id === p.ultimo) + 1) : 0).filter((m) => m.direccion === 'entrante' && m.tipo !== 'reaction').length;
        if (entrantes > 0) setNuevos((n) => n + entrantes);
      }
    }
    previo.current = { primero, ultimo, alto: el.scrollHeight, top: el.scrollTop, n: mensajes.length };
  }, [mensajes, alFinal]);

  function alDesplazar() {
    const el = contenedor.current;
    if (!el) return;
    const cerca = el.scrollHeight - el.scrollTop - el.clientHeight < CERCA_DEL_FONDO_PX;
    alFondo.current = cerca;
    if (cerca) setNuevos(0);
    previo.current.alto = el.scrollHeight;
    previo.current.top = el.scrollTop;
    if (el.scrollTop < 80 && hilo?.hayMas && !hilo.cargandoMas) void cargarAnteriores(conv.id);
  }

  // Adjuntar / pegar / arrastrar: se valida y convierte (fotos → JPG…) y se muestra la vista previa antes de enviar.
  const alArchivo = useCallback(async (file: File) => {
    try { setAdjunto(await prepararArchivo(file)); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo preparar el archivo.', 'error'); }
  }, [toast]);

  const onResponder = useCallback((m: Mensaje) => { if (m.wamid) setCitando(m); }, []);
  const onReintentar = useCallback(async (m: Mensaje) => {
    const r = await reintentarEnvio(m);
    if (!r.ok) toast(r.error ?? 'No se pudo reenviar.', r.incierto ? 'warning' : 'error');
  }, [toast]);

  // ── Ventana de 24 h ──
  const v = ventana(conv, ahora);
  const bloqueo = v.abierta ? null : conv.ultimo_entrante_at
    ? 'Pasaron más de 24 horas desde el último mensaje de este negocio. WhatsApp solo permite escribirle con una plantilla aprobada, y eso todavía no está disponible aquí. Si te escribe de nuevo, podrás responder.'
    : 'Este negocio aún no te ha escrito. Solo se le puede enviar la plantilla de saludo desde la pantalla Connexo; cuando responda, podrás conversar aquí.';

  const estado = conv.envio?.estado ? ESTADO_CONNEXO[conv.envio.estado as ConnexoEstado] : undefined;
  const detalle = [conv.envio?.rubro, conv.envio?.prospect_ciudad].filter(Boolean).join(' · ');

  // ── Borrador del agente: enviar tal cual, editar, otra versión o descartar ──
  const forzarEnvio = forzado && !v.abierta;
  async function enviarBorrador() {
    if (!borrador?.texto) return;
    setEnviandoBorrador(true);
    useAgenteStore.getState().quitarBorrador(conv.id, borrador.id);        // desaparece al instante; si el servidor lo rechaza, vuelve
    const r = await enviarTexto(conv.id, borrador.texto, null, forzarEnvio, borrador.id);
    setEnviandoBorrador(false);
    if (r.rechazado) { toast(r.error ?? 'No se pudo enviar el borrador.', 'error'); void cargarAgente(); }
    else if (!r.ok && r.incierto) toast(r.error ?? 'No se pudo confirmar el envío.', 'warning');
  }
  function editarBorrador() {
    if (!borrador?.texto) return;
    setSugerencia((s) => ({ clave: (s?.clave ?? 0) + 1, id: borrador.id, texto: borrador.texto ?? '' }));
  }
  async function pedirBorrador() {
    const r = await otraVersion(conv.id);
    if (r.error) toast(r.error, r.sin_clave ? 'warning' : 'error');
    else if (r.estado === 'omitido' || r.estado === 'obsoleto') toast(`El agente no redactó nada: ${r.motivo ?? 'no conviene responder'}.`, 'warning');
  }
  const puedeSugerir = !!modoAgente && modoAgente !== 'apagado' && v.abierta && conv.ultimo_dir === 'entrante' && !borrador;

  // Enviar un archivo (de la vista previa o una nota de voz): aparece al instante; si el servidor lo rechaza, se avisa.
  const puedeEscribir = !bloqueo || forzado;
  const mandarArchivo = (a: ArchivoListo, pie: string) => {
    const respondeA = citando?.wamid ?? null;
    setCitando(null);
    void enviarArchivo(conv.id, a, pie, respondeA, forzado && !v.abierta).then((r) => {
      if (!r.ok && r.rechazado) toast(r.error ?? 'No se pudo enviar el archivo.', 'error');
    });
  };
  const alSoltar = (e: React.DragEvent) => {
    e.preventDefault();
    setArrastrando(false);
    const f = e.dataTransfer.files[0];
    if (f && puedeEscribir) void alArchivo(f);
  };

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => { if (puedeEscribir && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setArrastrando(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastrando(false); }}
      onDrop={alSoltar}
    >
      {arrastrando && (
        <div className="pointer-events-none absolute inset-2 z-40 grid place-items-center rounded-lg border-2 border-dashed border-accent/60 bg-accent/10 backdrop-blur-[2px]">
          <p className="font-heading text-[15px] font-semibold text-accent-text">Suelta el archivo para enviarlo</p>
        </div>
      )}
      {/* Cabecera */}
      <header className="flex items-center gap-3 border-b border-line px-3 py-2.5 sm:px-4">
        <button onClick={onVolver} className="rounded-md p-1.5 text-ink-secondary hover:bg-veil/[0.06] lg:hidden" aria-label="Volver a los chats"><ArrowLeft className="h-5 w-5" /></button>
        <Avatar titulo={titulo} clave={conv.wa_id} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <h2 className="truncate font-heading text-[15px] font-semibold leading-tight text-ink-primary">{titulo}</h2>
            {estado && <Badge variant={estado.variant}>{estado.label}</Badge>}
          </div>
          <p className="truncate text-[12px] text-ink-muted">
            {formatPhoneEC(`+${conv.wa_id}`)}{detalle ? ` · ${detalle}` : ''}
            {conv.nombre_perfil && conv.nombre_perfil !== titulo ? ` · «${conv.nombre_perfil}» en WhatsApp` : ''}
          </p>
        </div>
        {conv.prospect_id && (
          <Link to={`/prospectos/${conv.prospect_id}`} className="hidden rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-secondary hover:bg-veil/[0.06] hover:text-ink-primary sm:inline-block">Ver prospecto</Link>
        )}
        {modoAgente && modoAgente !== 'apagado' && (
          <button
            onClick={() => void pausarEnChat(conv.id, !conv.agente_pausado)}
            className={`rounded-md p-2 hover:bg-veil/[0.06] ${conv.agente_pausado ? 'text-warning' : 'text-ink-muted hover:text-ink-primary'}`}
            title={conv.agente_pausado ? 'El agente está en pausa en este chat: toca para reanudarlo' : 'Pausar el agente en este chat (tú tomas la conversación)'}
            aria-label={conv.agente_pausado ? 'Reanudar el agente en este chat' : 'Pausar el agente en este chat'}
            aria-pressed={!!conv.agente_pausado}
          >
            {conv.agente_pausado ? <BotOff className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
          </button>
        )}
        <button onClick={() => void marcarComoNoLeida(conv.id)} className="rounded-md p-2 text-ink-muted hover:bg-veil/[0.06] hover:text-ink-primary" title="Marcar como no leída" aria-label="Marcar como no leída"><Mail className="h-4 w-4" /></button>
        <button onClick={onPanel} className={`hidden rounded-md p-2 hover:bg-veil/[0.06] xl:inline-flex ${panelAbierto ? 'text-accent-text' : 'text-ink-muted hover:text-ink-primary'}`} title={panelAbierto ? 'Ocultar la información del contacto' : 'Mostrar la información del contacto'} aria-label="Información del contacto" aria-pressed={panelAbierto}><PanelRight className="h-4 w-4" /></button>
        <button onClick={() => { void archivar(conv.id, !conv.archivada); if (!conv.archivada) onVolver(); }} className="rounded-md p-2 text-ink-muted hover:bg-veil/[0.06] hover:text-ink-primary" title={conv.archivada ? 'Desarchivar' : 'Archivar'} aria-label={conv.archivada ? 'Desarchivar' : 'Archivar'}>
          {conv.archivada ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
        </button>
      </header>

      {/* Mensajes */}
      <div className="relative min-h-0 flex-1">
        <div ref={contenedor} onScroll={alDesplazar} className="h-full overflow-y-auto px-3 py-3 sm:px-5" role="log" aria-live="polite" aria-label={`Mensajes con ${titulo}`}>
          {hilo?.cargandoMas && <div className="flex justify-center py-2 text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" /></div>}
          {hilo && !hilo.cargandoMas && hilo.hayMas && (
            <div className="flex justify-center py-2"><button onClick={() => void cargarAnteriores(conv.id)} className="rounded-full border border-line px-3 py-1 text-[12px] text-ink-secondary hover:bg-veil/[0.06]">Cargar mensajes anteriores</button></div>
          )}
          {!cargado && !hilo?.error && (visibles.length === 0) && (
            <div className="grid h-full place-items-center text-ink-muted"><Loader2 className="h-5 w-5 animate-spin" /></div>
          )}
          {hilo?.error && !cargado && (
            <div className="space-y-3 py-10 text-center text-sm">
              <p className="text-danger">{hilo.error}</p>
              <button onClick={() => void abrirHilo(conv.id, true)} className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-3 py-1.5 text-[13px] hover:bg-veil/[0.06]"><RefreshCw className="h-3.5 w-3.5" /> Reintentar</button>
            </div>
          )}
          {cargado && visibles.length === 0 && <p className="py-10 text-center text-sm text-ink-muted">Todavía no hay mensajes en este chat.</p>}

          {items.map((it) =>
            it.tipo === 'dia' ? (
              <div key={`d-${it.clave}`} className="sticky top-1 z-10 my-3 flex justify-center">
                <span className="rounded-full border border-line bg-surface-raised/95 px-3 py-0.5 text-[11.5px] font-medium text-ink-secondary shadow-sm backdrop-blur">{etiquetaDia(it.ts)}</span>
              </div>
            ) : (
              <Burbuja
                key={it.m.id}
                m={it.m}
                primero={it.primero}
                reacciones={it.m.wamid ? reacciones.get(it.m.wamid) : undefined}
                citado={it.m.responde_a ? porWamid.get(it.m.responde_a) : undefined}
                ahora={ahora}
                onResponder={onResponder}
                onReintentar={onReintentar}
              />
            ),
          )}
        </div>

        {nuevos > 0 && (
          <button onClick={() => { alFinal(true); setNuevos(0); }} className="absolute bottom-3 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-accent-on shadow-glow">
            <ArrowDown className="h-3.5 w-3.5" /> {nuevos} mensaje{nuevos > 1 ? 's' : ''} nuevo{nuevos > 1 ? 's' : ''}
          </button>
        )}
      </div>

      {borrador && v.abierta && (
        <BorradorAgenteCard
          borrador={borrador}
          generando={generando}
          enviando={enviandoBorrador}
          onEnviar={() => void enviarBorrador()}
          onEditar={editarBorrador}
          onOtra={() => void pedirBorrador()}
          onDescartar={() => void descartarBorrador(borrador)}
        />
      )}
      {puedeSugerir && (
        <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-base/40 px-3 py-1.5 sm:px-4">
          <span className="text-[12px] text-ink-muted">{conv.agente_pausado ? 'El agente está en pausa en este chat.' : 'El agente no ha dejado borrador para este mensaje.'}</span>
          <button onClick={() => void pedirBorrador()} disabled={generando} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-ink-secondary hover:bg-veil/[0.06] hover:text-ink-primary disabled:opacity-60">
            {generando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Sugerir respuesta
          </button>
        </div>
      )}

      <Compositor
        key={conv.id}
        convId={conv.id}
        bloqueo={bloqueo}
        restante={v.abierta ? textoRestante(v.restanteMs) : null}
        citando={citando}
        onQuitarCita={() => setCitando(null)}
        sugerencia={sugerencia}
        onEnviar={async (texto, respondeA, borradorId) => {
          const r = await enviarTexto(conv.id, texto, respondeA, forzarEnvio, borradorId);
          // La base ya lo marcó (enviado, editado o descartado); aquí se quita al instante sin esperar al aviso en vivo.
          if (!r.rechazado) useAgenteStore.getState().quitarBorrador(conv.id);
          return r;
        }}
        forzado={forzado}
        onForzar={setForzado}
        onArchivo={(f) => void alArchivo(f)}
        onNotaDeVoz={(a) => mandarArchivo(a, '')}
      />

      {adjunto && (
        <PreviaAdjunto
          archivo={adjunto}
          onCancelar={() => setAdjunto(null)}
          onEnviar={(pie) => { const a = adjunto; setAdjunto(null); mandarArchivo(a, pie); }}
        />
      )}
    </div>
  );
}
