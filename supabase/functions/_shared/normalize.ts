// Normalización de datos y deduplicación (secciones 5.7 y 7.2).

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

/** Teléfono ecuatoriano a E.164 (+593...). null si no parece válido. */
export function toE164EC(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+593')) return digits;
  if (digits.startsWith('593')) return `+${digits}`;
  if (digits.startsWith('0')) return `+593${digits.slice(1)}`;
  if (digits.length >= 8 && digits.length <= 9) return `+593${digits}`;
  return digits.startsWith('+') ? digits : `+${digits}`;
}

/** URL a minúsculas, sin parámetros de tracking ni barra final. */
export function cleanUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']
      .forEach((p) => u.searchParams.delete(p));
    let out = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`.replace(/\/$/, '');
    const qs = u.searchParams.toString();
    if (qs) out += `?${qs}`;
    return out;
  } catch {
    return null;
  }
}

/** Nombre: trim + colapsar espacios. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** Extrae @usuario de una URL o handle de Instagram. */
export function instagramHandle(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = v.match(/instagram\.com\/([^/?#]+)/i);
  const handle = (m ? m[1] : v).replace(/^@/, '').trim();
  return handle || null;
}

/** sha256 hex de un texto (para dedupe_hash). */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * dedupe_hash = sha256( slug(nombre) | slug(ciudad) | telefono ).
 * Si no hay teléfono usa el dominio del sitio; si no, el @usuario de Instagram.
 * (Sección 5.7.)
 */
export async function dedupeHash(input: {
  nombre: string;
  ciudad?: string | null;
  telefono?: string | null;
  website?: string | null;
  instagram?: string | null;
}): Promise<string> {
  let tercer = '';
  if (input.telefono) tercer = input.telefono;
  else if (input.website) {
    try { tercer = new URL(input.website).host.toLowerCase(); } catch { tercer = input.website; }
  } else if (input.instagram) tercer = `ig:${input.instagram}`;
  return sha256Hex(`${slug(input.nombre)}|${slug(input.ciudad ?? '')}|${tercer}`);
}
