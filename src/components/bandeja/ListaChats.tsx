import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, Loader2, MessageCircle, RefreshCw, Search } from 'lucide-react';
import { useBandejaStore } from '@/store/bandejaStore';
import { cargarLista } from '@/lib/bandeja/acciones';
import { fechaLista } from '@/lib/bandeja/formato';
import { filtrarConversaciones, tituloConversacion, type FiltroLista } from '@/lib/bandeja/orden';
import { Avatar, Ticks } from './piezas';

const FILTROS: Array<{ id: FiltroLista; etiqueta: string }> = [
  { id: 'respuestas', etiqueta: 'Respuestas' },
  { id: 'no_leidas', etiqueta: 'No leídas' },
  { id: 'sin_respuesta', etiqueta: 'Sin respuesta' },
  { id: 'archivadas', etiqueta: 'Archivadas' },
];

const VACIO: Record<FiltroLista, { titulo: string; texto: string }> = {
  respuestas: { titulo: 'Aún nadie ha respondido', texto: 'Cuando un negocio responda al WhatsApp de Connexo, su chat aparecerá aquí al instante.' },
  no_leidas: { titulo: 'Todo leído', texto: 'No tienes mensajes sin leer.' },
  sin_respuesta: { titulo: 'Nada pendiente', texto: 'Aquí están los negocios a los que se les envió el saludo y aún no responden.' },
  archivadas: { titulo: 'Sin archivadas', texto: 'Los chats que archives se guardan aquí y vuelven solos si el negocio escribe de nuevo.' },
};

export function ListaChats({ seleccionada, onSeleccionar }: { seleccionada: string | null; onSeleccionar: (id: string) => void }) {
  const conversaciones = useBandejaStore((s) => s.conversaciones);
  const listaCargada = useBandejaStore((s) => s.listaCargada);
  const cargando = useBandejaStore((s) => s.cargandoLista);
  const errorLista = useBandejaStore((s) => s.errorLista);
  const [filtro, setFiltro] = useState<FiltroLista>('respuestas');
  const [busqueda, setBusqueda] = useState('');

  const visibles = useMemo(() => filtrarConversaciones(conversaciones, filtro, busqueda), [conversaciones, filtro, busqueda]);
  const conteos = useMemo(() => ({
    no_leidas: conversaciones.filter((c) => !c.archivada && c.no_leidos > 0).length,
    sin_respuesta: conversaciones.filter((c) => !c.archivada && !c.ultimo_entrante_at).length,
  }), [conversaciones]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2.5 border-b border-line p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar negocio, celular o mensaje"
            aria-label="Buscar chats"
            className="glass-input h-9 w-full rounded-md pl-9 pr-3 text-[13px] text-ink-primary outline-none placeholder:text-ink-muted"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto pb-0.5" role="tablist" aria-label="Filtrar chats">
          {FILTROS.map((f) => {
            const activo = filtro === f.id;
            const n = f.id === 'no_leidas' ? conteos.no_leidas : f.id === 'sin_respuesta' ? conteos.sin_respuesta : 0;
            return (
              <button
                key={f.id}
                role="tab"
                aria-selected={activo}
                onClick={() => setFiltro(f.id)}
                className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                  activo ? 'border-accent/40 bg-accent/15 text-accent-text' : 'border-line text-ink-secondary hover:bg-veil/[0.06] hover:text-ink-primary'
                }`}
              >
                {f.etiqueta}
                {n > 0 && <span className={`tabular-nums ${activo ? '' : 'text-ink-muted'}`}>{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" role="list" aria-label="Chats">
        {!listaCargada && !errorLista && (
          <div className="grid place-items-center gap-2 py-16 text-ink-muted"><Loader2 className="h-5 w-5 animate-spin" /><span className="text-xs">Cargando chats…</span></div>
        )}
        {errorLista && !listaCargada && (
          <div className="space-y-3 p-6 text-center text-sm">
            <p className="text-danger">{errorLista}</p>
            <button onClick={() => void cargarLista()} className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-3 py-1.5 text-[13px] hover:bg-veil/[0.06]"><RefreshCw className={`h-3.5 w-3.5 ${cargando ? 'animate-spin' : ''}`} /> Reintentar</button>
          </div>
        )}
        {listaCargada && visibles.length === 0 && (
          <div className="px-6 py-14 text-center">
            <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-lg border border-line-strong bg-surface-elevated text-ink-muted">
              {busqueda ? <Search className="h-5 w-5" /> : filtro === 'respuestas' ? <MessageCircle className="h-5 w-5" /> : <Inbox className="h-5 w-5" />}
            </div>
            <p className="font-heading text-[15px] font-semibold text-ink-primary">{busqueda ? 'Sin resultados' : VACIO[filtro].titulo}</p>
            <p className="mx-auto mt-1.5 max-w-[250px] text-[12.5px] text-ink-secondary">{busqueda ? 'Prueba con otro nombre, celular o palabra.' : VACIO[filtro].texto}</p>
          </div>
        )}
        {visibles.map((c) => {
          const titulo = tituloConversacion(c);
          const activa = c.id === seleccionada;
          const sinLeer = c.no_leidos > 0;
          return (
            <Link
              key={c.id}
              to={`/bandeja?c=${c.id}`}
              role="listitem"
              onClick={(e) => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); onSeleccionar(c.id); } }}
              aria-current={activa ? 'true' : undefined}
              className={`flex gap-3 border-b border-line/60 px-3 py-3 transition-colors ${activa ? 'bg-accent/[0.09]' : 'hover:bg-veil/[0.04]'}`}
            >
              <Avatar titulo={titulo} clave={c.wa_id} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={`truncate text-[14px] ${sinLeer ? 'font-semibold text-ink-primary' : 'font-medium text-ink-primary'}`}>{titulo}</p>
                  <span className={`shrink-0 text-[11px] tabular-nums ${sinLeer ? 'font-medium text-accent-text' : 'text-ink-muted'}`}>{fechaLista(c.ultimo_mensaje_at)}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p className={`flex min-w-0 items-center gap-1 text-[12.5px] ${sinLeer ? 'text-ink-primary' : 'text-ink-secondary'}`}>
                    {c.ultimo_dir === 'saliente' && <Ticks estado={c.ultimo_estado} className="!h-[13px] !w-[13px]" />}
                    <span className="truncate">{c.ultimo_texto || '—'}</span>
                  </p>
                  {sinLeer && (
                    <span className="grid h-[19px] min-w-[19px] shrink-0 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular-nums text-accent-on" aria-label={`${c.no_leidos} sin leer`}>
                      {c.no_leidos > 99 ? '99+' : c.no_leidos}
                    </span>
                  )}
                </div>
                {c.envio?.estado === 'aceptado' && <p className="mt-1 text-[11px] font-medium text-success">Aceptó la demo</p>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
