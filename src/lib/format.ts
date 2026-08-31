/**
 * Utilidades de formato para KODA: teléfonos (E.164 Ecuador), fechas y moneda.
 */

/**
 * Normaliza un teléfono ecuatoriano a E.164 (+593...).
 * Devuelve null si no parece un número válido.
 * Usado también por el normalizador para el dedupe_hash (sección 5.7).
 */
export function toE164EC(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '');
  if (!digits) return null;

  if (digits.startsWith('+593')) return digits;
  if (digits.startsWith('593')) return `+${digits}`;
  // 0999999999 (móvil nacional) -> +59399999999
  if (digits.startsWith('0')) return `+593${digits.slice(1)}`;
  // 99999999 sin 0 inicial
  if (digits.length >= 8 && digits.length <= 9) return `+593${digits}`;
  return digits.startsWith('+') ? digits : `+${digits}`;
}

/** Presentación legible de un teléfono E.164 EC: +593 99 123 4567 */
export function formatPhoneEC(e164: string | null | undefined): string {
  if (!e164) return '—';
  const m = e164.match(/^\+593(\d{2})(\d{3})(\d{4})$/);
  if (!m) return e164;
  return `+593 ${m[1]} ${m[2]} ${m[3]}`;
}

const dateFmt = new Intl.DateTimeFormat('es-EC', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const dateTimeFmt = new Intl.DateTimeFormat('es-EC', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(value: string | number | Date | null | undefined): string {
  if (!value) return '—';
  return dateFmt.format(new Date(value));
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (!value) return '—';
  return dateTimeFmt.format(new Date(value));
}

/** "hace 3 h", "hace 2 d" — para last_seen_at, actividad, etc. */
export function timeAgo(value: string | number | Date | null | undefined): string {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return 'hace un momento';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `hace ${d} d`;
  const mo = Math.round(d / 30);
  return `hace ${mo} mes${mo > 1 ? 'es' : ''}`;
}

const usd = new Intl.NumberFormat('es-EC', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});

export function formatUSD(value: number | null | undefined): string {
  return usd.format(value ?? 0);
}

/** slug estable para el dedupe (minúsculas, sin acentos, sin símbolos). */
export function slug(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
