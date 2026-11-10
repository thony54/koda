/** Formato de horas y fechas de la bandeja (zona horaria del navegador; en Ecuador, America/Guayaquil). */
import { claveDia } from './orden';

const horaFmt = new Intl.DateTimeFormat('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false });
const diaSemanaFmt = new Intl.DateTimeFormat('es-EC', { weekday: 'short' });
const fechaCortaFmt = new Intl.DateTimeFormat('es-EC', { day: '2-digit', month: '2-digit', year: '2-digit' });
const diaLargoFmt = new Intl.DateTimeFormat('es-EC', { weekday: 'long', day: 'numeric', month: 'long' });
const diaLargoAnioFmt = new Intl.DateTimeFormat('es-EC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const horaCorta = (ts: string | null | undefined): string => (ts ? horaFmt.format(new Date(ts)) : '');

const diasEntre = (a: Date, b: Date): number => {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ua - ub) / 86_400_000);
};

/** Para la lista de chats: hora si es de hoy, «Ayer», día de la semana (última semana) o fecha. */
export function fechaLista(ts: string | null | undefined, ahora = new Date()): string {
  if (!ts) return '';
  const d = new Date(ts);
  const n = diasEntre(ahora, d);
  if (n <= 0) return horaCorta(ts);
  if (n === 1) return 'Ayer';
  if (n < 7) return diaSemanaFmt.format(d).replace('.', '');
  return fechaCortaFmt.format(d);
}

/** Separador de día dentro de un chat: «Hoy», «Ayer» o «lunes 9 de noviembre». */
export function etiquetaDia(ts: string, ahora = new Date()): string {
  const d = new Date(ts);
  const n = diasEntre(ahora, d);
  if (claveDia(ts) === claveDia(ahora.toISOString()) || n === 0) return 'Hoy';
  if (n === 1) return 'Ayer';
  const base = d.getFullYear() === ahora.getFullYear() ? diaLargoFmt.format(d) : diaLargoAnioFmt.format(d);
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function tamano(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Iniciales para el avatar: hasta 2 letras del nombre (o los últimos dígitos del celular). */
export function iniciales(titulo: string): string {
  const limpio = titulo.replace(/^\+/, '').trim();
  if (/^\d+$/.test(limpio)) return limpio.slice(-2);
  const palabras = limpio.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p));
  if (!palabras.length) return '?';
  const letra = (p: string) => (p.match(/[\p{L}\p{N}]/u) ?? ['?'])[0].toUpperCase();
  return palabras.length === 1 ? letra(palabras[0]) : letra(palabras[0]) + letra(palabras[1]);
}

/** Tono estable por contacto (0–5) para colorear el avatar. */
export function tonoDe(clave: string): number {
  let h = 0;
  for (let i = 0; i < clave.length; i++) h = (h * 31 + clave.charCodeAt(i)) >>> 0;
  return h % 6;
}
