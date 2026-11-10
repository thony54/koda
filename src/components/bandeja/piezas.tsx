import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import type { EstadoMensaje } from '@/lib/data/bandeja';
import { iniciales, tonoDe } from '@/lib/bandeja/formato';
import { partesDeTexto } from '@/lib/bandeja/orden';

const TONOS = [
  'bg-accent/15 text-accent-text',
  'bg-info/15 text-info',
  'bg-success/15 text-success',
  'bg-warning/15 text-warning',
  'bg-danger/15 text-danger',
  'bg-veil/10 text-ink-secondary',
];

export function Avatar({ titulo, clave, size = 'md' }: { titulo: string; clave: string; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'h-14 w-14 text-lg' : size === 'sm' ? 'h-8 w-8 text-[11px]' : 'h-11 w-11 text-sm';
  return (
    <span
      aria-hidden
      className={`grid shrink-0 select-none place-items-center rounded-full border border-line font-heading font-semibold ${dim} ${TONOS[tonoDe(clave)]}`}
    >
      {iniciales(titulo)}
    </span>
  );
}

/** Marcas de entrega de un mensaje enviado: reloj → ✓ → ✓✓ → ✓✓ azul (leído); triángulo si falló. */
export function Ticks({ estado, sinConfirmar = false, className = '' }: { estado: EstadoMensaje | null | undefined; sinConfirmar?: boolean; className?: string }) {
  const base = `inline-block h-[14px] w-[14px] shrink-0 ${className}`;
  if (estado === 'fallido') return <AlertCircle className={`${base} text-danger`} aria-label="No se envió" />;
  if (estado === 'enviando') {
    return <Clock className={`${base} ${sinConfirmar ? 'text-warning' : 'text-ink-muted'}`} aria-label={sinConfirmar ? 'Sin confirmar' : 'Enviando'} />;
  }
  if (estado === 'leido') return <CheckCheck className={`${base} text-info`} aria-label="Leído" />;
  if (estado === 'entregado') return <CheckCheck className={`${base} text-ink-muted`} aria-label="Entregado" />;
  if (estado === 'enviado') return <Check className={`${base} text-ink-muted`} aria-label="Enviado" />;
  return null;
}

/** Texto con enlaces clicables y el formato de WhatsApp (*negrita*, _cursiva_, ~tachado~, `mono`). Nunca inyecta HTML. */
export function TextoWhatsApp({ texto }: { texto: string }) {
  return (
    <>
      {partesDeTexto(texto).map((p, i) => {
        switch (p.t) {
          case 'url':
            return (
              <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-info underline decoration-info/40 underline-offset-2 hover:decoration-info">
                {p.v}
              </a>
            );
          case 'b': return <strong key={i} className="font-semibold">{p.v}</strong>;
          case 'i': return <em key={i}>{p.v}</em>;
          case 's': return <s key={i} className="opacity-80">{p.v}</s>;
          case 'code': return <code key={i} className="!bg-veil/10 !px-1 !py-0 !text-[0.9em] !text-ink-primary">{p.v}</code>;
          default: return <span key={i}>{p.v}</span>;
        }
      })}
    </>
  );
}
