import { Link } from 'react-router-dom';
import { Clock, ExternalLink, MapPin, MessageCircle, Phone, Store } from 'lucide-react';
import { Badge } from '@/components/ui';
import { ESTADO_CONNEXO, type ConnexoEstado } from '@/lib/data/connexo';
import type { Conversacion } from '@/lib/data/bandeja';
import { formatDateTime, formatPhoneEC } from '@/lib/format';
import { textoRestante, tituloConversacion, ventana } from '@/lib/bandeja/orden';
import { Avatar } from './piezas';

const CONNEXO_PUBLICO = 'https://www.connexoapp.com';      // OJO: sin «www» no resuelve

function Fila({ icono, titulo, children }: { icono: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-[13px]">
      <span className="mt-0.5 shrink-0 text-ink-muted">{icono}</span>
      <div className="min-w-0">
        <p className="eyebrow !text-[10px]">{titulo}</p>
        <div className="mt-0.5 break-words text-ink-primary">{children}</div>
      </div>
    </div>
  );
}

export function PanelContacto({ conv }: { conv: Conversacion }) {
  const titulo = tituloConversacion(conv);
  const e = conv.envio;
  const estado = e?.estado ? ESTADO_CONNEXO[e.estado as ConnexoEstado] : undefined;
  const v = ventana(conv);

  return (
    <div className="h-full space-y-5 overflow-y-auto p-5">
      <div className="flex flex-col items-center text-center">
        <Avatar titulo={titulo} clave={conv.wa_id} size="lg" />
        <h3 className="mt-3 font-heading text-[16px] font-semibold leading-tight text-ink-primary">{titulo}</h3>
        {conv.nombre_perfil && conv.nombre_perfil !== titulo && <p className="mt-0.5 text-[12px] text-ink-muted">«{conv.nombre_perfil}» en WhatsApp</p>}
        {estado && <div className="mt-2.5"><Badge variant={estado.variant} size="md">{estado.label}</Badge></div>}
        {estado && <p className="mt-1.5 max-w-[240px] text-[11.5px] text-ink-muted">{estado.hint}</p>}
      </div>

      <div className="space-y-4 border-t border-line pt-4">
        <Fila icono={<Phone className="h-4 w-4" />} titulo="Celular">
          <a href={`https://wa.me/${conv.wa_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-info hover:underline">
            {formatPhoneEC(`+${conv.wa_id}`)} <ExternalLink className="h-3 w-3" />
          </a>
        </Fila>
        {(e?.rubro || e?.prospect_ciudad) && (
          <Fila icono={<Store className="h-4 w-4" />} titulo="Negocio">
            {[e?.rubro, e?.prospect_ciudad].filter(Boolean).join(' · ')}
          </Fila>
        )}
        {e?.busqueda_nombre && <Fila icono={<MapPin className="h-4 w-4" />} titulo="Búsqueda">{e.busqueda_nombre}</Fila>}
        <Fila icono={<Clock className="h-4 w-4" />} titulo="Ventana de 24 h">
          {v.abierta
            ? <span className="text-success">Abierta · quedan {textoRestante(v.restanteMs)}</span>
            : <span className="text-warning">{conv.ultimo_entrante_at ? 'Cerrada' : 'Aún no te ha escrito'}</span>}
          {conv.ultimo_entrante_at && <span className="block text-[11.5px] text-ink-muted">Último mensaje suyo: {formatDateTime(conv.ultimo_entrante_at)}</span>}
        </Fila>
        <Fila icono={<MessageCircle className="h-4 w-4" />} titulo="Chat desde">{formatDateTime(conv.created_at)}</Fila>
      </div>

      <div className="space-y-2 border-t border-line pt-4">
        {conv.prospect_id && (
          <Link to={`/prospectos/${conv.prospect_id}`} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-[13px] text-ink-primary hover:bg-veil/[0.06]">
            Ver ficha del prospecto <ExternalLink className="h-3.5 w-3.5 text-ink-muted" />
          </Link>
        )}
        {e?.connexo_username && (
          <a href={`${CONNEXO_PUBLICO}/${encodeURIComponent(e.connexo_username)}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-[13px] text-ink-primary hover:bg-veil/[0.06]">
            Ver su perfil en Connexo <ExternalLink className="h-3.5 w-3.5 text-ink-muted" />
          </a>
        )}
        {e && (
          <Link to="/connexo" className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-[13px] text-ink-primary hover:bg-veil/[0.06]">
            Abrir en Connexo <ExternalLink className="h-3.5 w-3.5 text-ink-muted" />
          </Link>
        )}
      </div>
    </div>
  );
}
