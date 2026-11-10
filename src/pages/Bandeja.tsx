import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bell, BellOff, MessageCircle, Volume2, VolumeX } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { ListaChats } from '@/components/bandeja/ListaChats';
import { VistaChat } from '@/components/bandeja/VistaChat';
import { PanelContacto } from '@/components/bandeja/PanelContacto';
import { useBandejaStore, type EstadoConexion } from '@/store/bandejaStore';
import { importarSaludos } from '@/lib/data/bandeja';
import { cargarLista } from '@/lib/bandeja/acciones';
import { useUIStore } from '@/store/uiStore';

const CONEXION: Record<EstadoConexion, { texto: string; punto: string; color: string }> = {
  en_vivo: { texto: 'En vivo', punto: 'bg-success', color: 'text-success' },
  conectando: { texto: 'Conectando…', punto: 'bg-warning animate-pulse', color: 'text-warning' },
  reconectando: { texto: 'Reconectando…', punto: 'bg-warning animate-pulse', color: 'text-warning' },
  sin_conexion: { texto: 'Sin conexión', punto: 'bg-danger', color: 'text-danger' },
};

const PANEL_CLAVE = 'koda.bandeja.panel';
const leerPanel = (): boolean => {
  try { const v = localStorage.getItem(PANEL_CLAVE); if (v !== null) return v === '1'; } catch { /* sin almacenamiento */ }
  return window.innerWidth >= 1700;       // en pantallas anchas se muestra; en el resto, el chat manda
};

const SALUDOS_IMPORTADOS = 'koda.bandeja.saludos-importados';
const leerFlag = () => { try { return localStorage.getItem(SALUDOS_IMPORTADOS) === '1'; } catch { return false; } };
const guardarFlag = () => { try { localStorage.setItem(SALUDOS_IMPORTADOS, '1'); } catch { /* sin almacenamiento */ } };

export default function Bandeja() {
  const [params, setParams] = useSearchParams();
  const seleccionId = params.get('c');
  const conversaciones = useBandejaStore((s) => s.conversaciones);
  const listaCargada = useBandejaStore((s) => s.listaCargada);
  const conexion = useBandejaStore((s) => s.conexion);
  const sonido = useBandejaStore((s) => s.sonido);
  const setSonido = useBandejaStore((s) => s.setSonido);
  const setConvAbierta = useBandejaStore((s) => s.setConvAbierta);
  const toast = useUIStore((s) => s.toast);
  const [panel, setPanel] = useState(leerPanel);
  const [permiso, setPermiso] = useState<NotificationPermission | 'no_soportado'>(() => (typeof Notification === 'undefined' ? 'no_soportado' : Notification.permission));

  const conv = useMemo(() => conversaciones.find((c) => c.id === seleccionId) ?? null, [conversaciones, seleccionId]);

  // El chat abierto lo sabe el resto de la app (para no sonar por un mensaje que ya estás viendo).
  useEffect(() => {
    setConvAbierta(conv?.id ?? null);
    return () => setConvAbierta(null);
  }, [conv?.id, setConvAbierta]);

  // Una sola vez: trae los saludos que Connexo ya había enviado, para que cada chat empiece con el suyo.
  useEffect(() => {
    if (!listaCargada || leerFlag()) return;
    importarSaludos()
      .then(() => { guardarFlag(); void cargarLista(); })
      .catch((e) => console.warn('[bandeja] no se pudieron importar los saludos:', e instanceof Error ? e.message : e));
  }, [listaCargada]);

  const seleccionar = (id: string | null) => {
    const sig = new URLSearchParams(params);
    if (id) sig.set('c', id); else sig.delete('c');
    setParams(sig, { replace: false });
  };

  const alternarPanel = () => setPanel((v) => { try { localStorage.setItem(PANEL_CLAVE, v ? '0' : '1'); } catch { /* sin almacenamiento */ } return !v; });

  async function activarAvisos() {
    if (typeof Notification === 'undefined') return;
    const r = await Notification.requestPermission();
    setPermiso(r);
    toast(r === 'granted' ? 'Avisos activados: te llegará una notificación cuando escriban y no estés en esta pestaña.' : 'El navegador no permitió las notificaciones.', r === 'granted' ? 'success' : 'warning');
  }

  const c = CONEXION[conexion];
  const acciones = (
    <>
      <span className={`inline-flex h-8 items-center gap-2 rounded-md border border-line px-3 text-xs font-medium ${c.color}`} role="status" title="Estado de la conexión en tiempo real">
        <span className={`h-2 w-2 rounded-full ${c.punto}`} /> {c.texto}
      </span>
      <button
        onClick={() => setSonido(!sonido)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-secondary hover:bg-veil/[0.06] hover:text-ink-primary"
        title={sonido ? 'Silenciar el aviso sonoro' : 'Activar el aviso sonoro'}
        aria-label={sonido ? 'Silenciar el aviso sonoro' : 'Activar el aviso sonoro'}
        aria-pressed={sonido}
      >
        {sonido ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
      </button>
      {permiso !== 'no_soportado' && (
        <button
          onClick={() => void activarAvisos()}
          disabled={permiso !== 'default'}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-xs font-medium text-ink-secondary hover:bg-veil/[0.06] hover:text-ink-primary disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent"
          title={permiso === 'denied' ? 'Las notificaciones están bloqueadas en este navegador' : undefined}
        >
          {permiso === 'granted' ? <><Bell className="h-3.5 w-3.5 text-success" /> Avisos activos</> : permiso === 'denied' ? <><BellOff className="h-3.5 w-3.5" /> Avisos bloqueados</> : <><Bell className="h-3.5 w-3.5" /> Activar avisos</>}
        </button>
      )}
    </>
  );

  return (
    <div>
      {/* En el celular, con un chat abierto el chat ocupa toda la pantalla. */}
      <div className={conv ? 'hidden lg:block' : ''}>
        <PageHeader eyebrow="WhatsApp de Connexo" title="Bandeja" actions={acciones} />
      </div>

      <div className={`glass-panel flex overflow-hidden rounded-lg ${conv ? 'h-[calc(100dvh-9rem)] min-h-[420px] lg:h-[calc(100dvh-13.5rem)] lg:min-h-[480px]' : 'h-[calc(100dvh-13.5rem)] min-h-[480px]'}`}>
        <aside className={`${conv ? 'hidden lg:flex' : 'flex'} w-full shrink-0 flex-col border-r border-line lg:w-[380px]`}>
          <ListaChats seleccionada={conv?.id ?? null} onSeleccionar={(id) => seleccionar(id)} />
        </aside>

        <section className={`${conv ? 'flex' : 'hidden lg:flex'} min-w-0 flex-1 flex-col`}>
          {conv ? (
            <VistaChat key={conv.id} conv={conv} onVolver={() => seleccionar(null)} panelAbierto={panel} onPanel={alternarPanel} />
          ) : seleccionId && listaCargada ? (
            <div className="grid h-full place-items-center p-8 text-center text-sm text-ink-secondary">
              <div>
                <p className="font-heading text-base font-semibold text-ink-primary">No encontré ese chat</p>
                <p className="mt-1">Puede que ya no exista. Elige otro de la lista.</p>
              </div>
            </div>
          ) : (
            <div className="grid h-full place-items-center p-8 text-center">
              <div>
                <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-xl border border-line-strong bg-surface-elevated text-accent-text"><MessageCircle className="h-6 w-6" /></div>
                <h2 className="font-heading text-lg font-semibold text-ink-primary">Elige un chat</h2>
                <p className="mx-auto mt-1.5 max-w-xs text-sm text-ink-secondary">Los mensajes nuevos aparecen al instante, sin recargar la página.</p>
              </div>
            </div>
          )}
        </section>

        {conv && panel && (
          <aside className="hidden w-[300px] shrink-0 border-l border-line xl:block">
            <PanelContacto conv={conv} />
          </aside>
        )}
      </div>
    </div>
  );
}
