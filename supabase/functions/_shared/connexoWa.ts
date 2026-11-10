// Llamadas de KODA a la función `kodaWhatsApp` de Connexo (única con el token de Meta). Las usan
// `koda-wa-inbox` (bajar archivos) y `koda-connexo` (responder, importar saludos).
//
// Secrets: CONNEXO_BRIDGE_URL (…/functions/v1/kodaIntake) y CONNEXO_BRIDGE_SECRET; opcional CONNEXO_WA_URL (…/kodaWhatsApp).
import type { Json } from './waBandeja.ts';

export class WaSinConfigurar extends Error {
  constructor() {
    super('El puente con Connexo no está configurado (faltan CONNEXO_BRIDGE_URL / CONNEXO_BRIDGE_SECRET).');
  }
}

/** Error de una llamada a Connexo. `status` = código HTTP si Connexo respondió (4xx = rechazo definitivo); null si no hubo respuesta. */
export class ErrorWa extends Error {
  status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.status = status;
  }
}

export function urlWa(): string | null {
  const explicita = Deno.env.get('CONNEXO_WA_URL');
  if (explicita) return explicita;
  const base = Deno.env.get('CONNEXO_BRIDGE_URL');
  if (!base) return null;
  const deducida = base.replace(/\/kodaIntake\/?$/, '/kodaWhatsApp');
  return deducida === base ? null : deducida;
}

export async function llamarWa(body: Json, timeoutMs = 30_000): Promise<Json> {
  const url = urlWa();
  const secret = Deno.env.get('CONNEXO_BRIDGE_SECRET');
  if (!url || !secret) throw new WaSinConfigurar();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-koda-secret': secret },
      body: JSON.stringify({ v: 1, ...body }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({} as Json));
    if (!res.ok) throw new ErrorWa(data?.error ?? `Connexo respondió ${res.status}.`, res.status);
    return data;
  } catch (e) {
    if (e instanceof ErrorWa || e instanceof WaSinConfigurar) throw e;
    if (e instanceof DOMException && e.name === 'AbortError') throw new ErrorWa('Connexo tardó demasiado en responder.', null);
    throw new ErrorWa(e instanceof Error ? e.message : String(e), null);
  } finally {
    clearTimeout(timer);
  }
}
