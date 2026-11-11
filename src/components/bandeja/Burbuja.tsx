import { memo } from 'react';
import { MapPin, RefreshCw, Reply, User } from 'lucide-react';
import type { Mensaje } from '@/lib/data/bandeja';
import { horaCorta } from '@/lib/bandeja/formato';
import type { Reacciones } from '@/lib/bandeja/orden';
import { Ticks, TextoWhatsApp } from './piezas';
import { ArchivoMensaje } from './ArchivoMensaje';

const SIN_CONFIRMAR_MS = 60_000;
const TIPOS_ARCHIVO = new Set(['image', 'video', 'audio', 'document', 'sticker']);

/** Cómo se nombra un mensaje en una cita o en la lista. */
export function resumenMensaje(m: Mensaje): string {
  switch (m.tipo) {
    case 'image': return `📷 ${m.texto || 'Foto'}`;
    case 'video': return `🎥 ${m.texto || 'Video'}`;
    case 'audio': return m.media?.voz ? '🎤 Mensaje de voz' : '🎧 Audio';
    case 'document': return `📄 ${m.media?.nombre ?? m.texto ?? 'Documento'}`;
    case 'sticker': return 'Sticker';
    case 'location': return '📍 Ubicación';
    case 'contacts': return '👤 Contacto';
    case 'template': return '📨 Saludo inicial enviado';
    case 'unsupported': return 'Mensaje no compatible';
    default: return m.texto ?? '';
  }
}

interface Props {
  m: Mensaje;
  primero: boolean;
  reacciones?: Reacciones;
  citado?: Mensaje;
  /** Hora actual (se actualiza cada pocos segundos): decide si una respuesta lleva demasiado «enviando». */
  ahora: number;
  onResponder: (m: Mensaje) => void;
  onReintentar: (m: Mensaje) => void;
}

function Contenido({ m }: { m: Mensaje }) {
  const extra = (m.extra ?? {}) as Record<string, unknown>;
  if (TIPOS_ARCHIVO.has(m.tipo)) {
    return (
      <div className="space-y-1.5">
        <ArchivoMensaje m={m} />
        {m.texto && <p className="whitespace-pre-wrap break-words"><TextoWhatsApp texto={m.texto} /></p>}
      </div>
    );
  }
  if (m.tipo === 'location') {
    const lat = Number(extra.lat); const lng = Number(extra.lng);
    const ok = Number.isFinite(lat) && Number.isFinite(lng);
    return (
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 font-medium"><MapPin className="h-4 w-4 text-accent-text" /> Ubicación</p>
        {m.texto && <p className="break-words text-[13px]">{m.texto}</p>}
        {ok && (
          <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noopener noreferrer" className="text-[13px] text-info underline underline-offset-2">
            Abrir en el mapa
          </a>
        )}
      </div>
    );
  }
  if (m.tipo === 'contacts') {
    const lista = (Array.isArray(extra.contactos) ? extra.contactos : []) as Array<{ nombre?: string | null; telefonos?: string[] }>;
    return (
      <div className="space-y-1.5">
        {lista.map((c, i) => (
          <p key={i} className="flex items-start gap-1.5 text-[13px]">
            <User className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" />
            <span><span className="font-medium">{c.nombre ?? 'Contacto'}</span>{c.telefonos?.length ? <span className="block text-ink-secondary">{c.telefonos.join(' · ')}</span> : null}</span>
          </p>
        ))}
      </div>
    );
  }
  if (m.tipo === 'template') {
    return <p className="italic text-ink-secondary">📨 {String((extra as { etiqueta?: string }).etiqueta ?? 'Plantilla enviada')}</p>;
  }
  if (m.tipo === 'unsupported') {
    return <p className="italic text-ink-secondary">Mensaje no compatible. Ábrelo en WhatsApp Business para verlo.</p>;
  }
  return (
    <p className="whitespace-pre-wrap break-words">
      {(m.tipo === 'button' || m.tipo === 'interactive') && (
        <span className="mr-1.5 rounded border border-line bg-veil/[0.06] px-1.5 py-px align-middle text-[10px] font-medium uppercase tracking-wide text-ink-muted">Botón</span>
      )}
      <TextoWhatsApp texto={m.texto ?? ''} />
    </p>
  );
}

function BurbujaBase({ m, primero, reacciones, citado, ahora, onResponder, onReintentar }: Props) {
  const saliente = m.direccion === 'saliente';
  const sinConfirmar = m.estado === 'enviando' && ahora - Date.parse(m.ts) > SIN_CONFIRMAR_MS;
  const fallido = m.estado === 'fallido';
  const emojis = [reacciones?.entrante, reacciones?.saliente].filter(Boolean) as string[];
  const solo = m.tipo === 'sticker';

  return (
    <div className={`group flex ${saliente ? 'justify-end' : 'justify-start'} ${primero ? 'mt-2.5' : 'mt-0.5'} ${emojis.length ? 'mb-2.5' : ''}`} data-mensaje={m.id}>
      {saliente && (
        <button
          onClick={() => onResponder(m)}
          disabled={!m.wamid}
          aria-label="Responder a este mensaje"
          className="mr-1 self-center rounded-full p-1.5 text-ink-muted opacity-0 transition-opacity [@media(hover:none)]:opacity-60 hover:bg-veil/[0.08] hover:text-ink-primary focus-visible:opacity-100 group-hover:opacity-100 disabled:hidden"
        >
          <Reply className="h-4 w-4" />
        </button>
      )}
      <div className="relative max-w-[82%] sm:max-w-[68%]">
        <div
          className={`${solo ? '' : 'border px-3 py-2 shadow-sm'} text-[14px] leading-snug text-ink-primary ${
            solo ? '' : saliente
              ? `border-accent/25 bg-accent/[0.13] ${primero ? 'rounded-2xl rounded-tr-md' : 'rounded-2xl'}`
              : `border-line bg-surface-elevated ${primero ? 'rounded-2xl rounded-tl-md' : 'rounded-2xl'}`
          } ${fallido ? '!border-danger/50' : ''}`}
        >
          {m.responde_a && (
            <div className="mb-1.5 rounded-md border-l-2 border-accent bg-black/20 px-2 py-1 text-[12px]">
              <p className="font-medium text-accent-text">{citado ? (citado.direccion === 'saliente' ? 'Tú' : 'Cliente') : 'Mensaje anterior'}</p>
              <p className="line-clamp-2 break-words text-ink-secondary">{citado ? resumenMensaje(citado) : 'No está en los mensajes cargados'}</p>
            </div>
          )}
          <Contenido m={m} />
          <div className={`mt-1 flex items-center justify-end gap-1 text-[10.5px] ${solo ? 'rounded-full bg-black/40 px-2 py-0.5 text-white' : 'text-ink-muted'}`}>
            {saliente && (m.extra as { agente?: boolean } | null)?.agente === true && (
              <span className="rounded border border-line px-1 py-px text-[9.5px] font-medium uppercase tracking-wide text-ink-muted" title="Lo envió el agente en modo automático">Agente</span>
            )}
            <span className="tabular-nums">{horaCorta(m.ts)}</span>
            {saliente && <Ticks estado={m.estado} sinConfirmar={sinConfirmar} />}
          </div>
        </div>

        {emojis.length > 0 && (
          <span className={`absolute -bottom-3 ${saliente ? 'right-3' : 'left-3'} rounded-full border border-line bg-surface-raised px-1.5 py-px text-[13px] shadow-sm`} aria-label="Reacción">
            {emojis.join('')}
          </span>
        )}

        {(fallido || sinConfirmar) && saliente && (
          <div className={`mt-1 flex items-start justify-end gap-2 text-[11.5px] ${fallido ? 'text-danger' : 'text-warning'}`} role="alert">
            <span className="max-w-[280px] text-right">
              {fallido ? (m.error ?? 'No se pudo enviar.') : 'Sin confirmar: pudo haber salido. Espera antes de reenviar para no duplicarlo.'}
            </span>
            <button onClick={() => onReintentar(m)} className="inline-flex shrink-0 items-center gap-1 rounded border border-current/40 px-1.5 py-0.5 font-medium hover:bg-veil/[0.06]">
              <RefreshCw className="h-3 w-3" /> {fallido ? 'Reintentar' : 'Reenviar'}
            </button>
          </div>
        )}
      </div>
      {!saliente && (
        <button
          onClick={() => onResponder(m)}
          disabled={!m.wamid}
          aria-label="Responder a este mensaje"
          className="ml-1 self-center rounded-full p-1.5 text-ink-muted opacity-0 transition-opacity [@media(hover:none)]:opacity-60 hover:bg-veil/[0.08] hover:text-ink-primary focus-visible:opacity-100 group-hover:opacity-100 disabled:hidden"
        >
          <Reply className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export const Burbuja = memo(BurbujaBase);
