// Fuente OpenStreetMap vía Overpass API (gratis, ODbL). Sección 4.1.
// Geocodifica la ciudad con Nominatim si el job no trae lat/lng.

const UA = 'KODA-Connexo/1.0 (prospeccion comercial; contacto: connexoec@gmail.com)';

export interface RawPlace {
  external_id: string;
  payload: Record<string, unknown>;
}

export async function geocodeCity(
  ciudad: string,
  pais = 'Ecuador',
): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    `${ciudad}, ${pais}`,
  )}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const data = (await res.json()) as { lat: string; lon: string }[];
  if (!data.length) return null;
  return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
}

const AMENITIES =
  'restaurant|cafe|bar|fast_food|pub|ice_cream|pharmacy|bank|fuel|clinic|' +
  'dentist|veterinary|doctors|gym|fitness_centre|marketplace|driving_school';

/**
 * Busca negocios alrededor de un punto. Devuelve elementos crudos de Overpass.
 * @param max límite de resultados.
 */
export async function overpassSearch(opts: {
  lat: number;
  lng: number;
  radio: number;
  max: number;
}): Promise<RawPlace[]> {
  const { lat, lng, radio, max } = opts;
  const q = `[out:json][timeout:25];
(
  nwr(around:${radio},${lat},${lng})[shop][name];
  nwr(around:${radio},${lat},${lng})[amenity~"${AMENITIES}"][name];
  nwr(around:${radio},${lat},${lng})[office][name];
  nwr(around:${radio},${lat},${lng})[craft][name];
);
out center tags ${Math.min(max, 500)};`;

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: `data=${encodeURIComponent(q)}`,
  });
  if (!res.ok) throw new Error(`Overpass respondió ${res.status}`);
  const data = (await res.json()) as { elements: OsmElement[] };
  return (data.elements ?? []).slice(0, max).map((el) => ({
    external_id: `osm:${el.type}/${el.id}`,
    payload: el as unknown as Record<string, unknown>,
  }));
}

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
