// Fuente Google Places API (New) — Text Search. Sección 4.1 y 4.3.
// Requiere GOOGLE_PLACES_API_KEY en los Secrets. Es PAGA: se controla con
// max_resultados por job y COSTO_MAX_MENSUAL_USD.
//
// Cumplimiento de caché (4.3): guardamos place_id de forma permanente; los
// campos de Google se refrescan y no se almacenan indefinidamente sin actualizar.

import type { RawPlace } from './osm.ts';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

// Costo aproximado por request de Text Search (referencial, para el tope).
export const GOOGLE_TEXTSEARCH_COST = 0.032;

export async function googleTextSearch(opts: {
  query: string;
  lat?: number;
  lng?: number;
  radio?: number;
  max: number;
  apiKey: string;
}): Promise<RawPlace[]> {
  const { query, lat, lng, radio, max, apiKey } = opts;

  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: 'es',
    regionCode: 'EC',
    maxResultCount: Math.min(max, 20),
  };
  if (lat != null && lng != null) {
    body.locationBias = {
      circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(radio ?? 15000, 50000) },
    };
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,' +
        'places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,' +
        'places.rating,places.userRatingCount,places.businessStatus,places.primaryType,' +
        'places.googleMapsUri',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(explicarErrorGoogle(res.status, txt));
  }
  const data = (await res.json()) as { places?: GooglePlace[] };
  return (data.places ?? []).slice(0, max).map((p) => ({
    external_id: `gplace:${p.id}`,
    payload: p as unknown as Record<string, unknown>,
  }));
}

// Traduce los errores típicos de la API key a un mensaje accionable en español.
// El más común: la key se creó con restricción «Sitios web (referrers HTTP)» y
// las funciones de Supabase llaman desde el servidor, sin referer.
function explicarErrorGoogle(status: number, txt: string): string {
  let msg = '';
  let reason = '';
  try {
    const e = JSON.parse(txt)?.error;
    msg = String(e?.message ?? '');
    reason = String(e?.details?.find?.((d: { reason?: string }) => d?.reason)?.reason ?? e?.status ?? '');
  } catch { /* respuesta no-JSON: usamos el texto crudo */ }
  const crudo = (msg || txt).replace(/\s+/g, ' ').slice(0, 160);

  if (/referer/i.test(msg)) {
    return 'Google bloqueó la API key porque tiene restricción de «Sitios web (referrers HTTP)». ' +
      'KODA llama a Google desde el servidor y eso no envía referer. En Google Cloud Console → APIs y servicios → ' +
      'Credenciales → tu API key → «Restricciones de la aplicación» elige «Ninguna» (o no pongas restricción de sitio web) ' +
      'y en «Restricciones de API» deja solo «Places API (New)». Guarda y espera 1-2 minutos.';
  }
  if (/ip address|IP_ADDRESS/i.test(msg + reason)) {
    return 'Google bloqueó la API key porque tiene restricción por direcciones IP y las funciones de KODA no tienen IP fija. ' +
      'En Google Cloud Console → Credenciales → tu API key → «Restricciones de la aplicación» elige «Ninguna» ' +
      'y limita la key por «Restricciones de API» a «Places API (New)».';
  }
  if (/SERVICE_DISABLED|has not been used|is disabled|API_KEY_SERVICE_BLOCKED|blocked.*API/i.test(msg + reason)) {
    return 'La API key no tiene permitida «Places API (New)». En Google Cloud Console activa «Places API (New)» ' +
      'en el proyecto y, si la key tiene «Restricciones de API», incluye «Places API (New)» en la lista.';
  }
  if (/API_KEY_INVALID|API key not valid/i.test(msg + reason)) {
    return 'La API key de Google Places no es válida. Revisa que la copiaste completa (empieza con «AIza») y vuelve a guardarla en Configuración → Integraciones.';
  }
  if (/billing/i.test(msg)) {
    return 'El proyecto de Google Cloud no tiene facturación activa. Places API (New) la necesita: actívala en Google Cloud Console → Facturación.';
  }
  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(reason)) {
    return 'Google Places llegó a su límite de cuota. Espera unos minutos o revisa las cuotas en Google Cloud Console.';
  }
  return `Google Places respondió ${status}: ${crudo}`;
}

interface GooglePlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  primaryType?: string;
  googleMapsUri?: string;
}
