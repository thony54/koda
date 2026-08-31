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
    throw new Error(`Google Places respondió ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as { places?: GooglePlace[] };
  return (data.places ?? []).slice(0, max).map((p) => ({
    external_id: `gplace:${p.id}`,
    payload: p as unknown as Record<string, unknown>,
  }));
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
