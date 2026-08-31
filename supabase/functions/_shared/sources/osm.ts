// Fuente OpenStreetMap vía Overpass API (gratis, ODbL). Sección 4.1.
// Geocodifica la ciudad con Nominatim si el job no trae lat/lng.

const UA = 'KODA-Connexo/1.0 (prospeccion comercial; contacto: connexoec@gmail.com)';

export interface RawPlace {
  external_id: string;
  payload: Record<string, unknown>;
}

// Gazetteer de ciudades objetivo con el CENTRO urbano real (no el centroide del
// cantón). Evita depender de Nominatim, que suele bloquear IPs de datacenter
// como las de las Edge Functions.
const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  ibarra: { lat: 0.3517, lng: -78.1223 },
  otavalo: { lat: 0.2344, lng: -78.2611 },
  quito: { lat: -0.1807, lng: -78.4678 },
  guayaquil: { lat: -2.1709, lng: -79.9224 },
  cuenca: { lat: -2.9006, lng: -79.0045 },
  ambato: { lat: -1.2543, lng: -78.6229 },
  'santo domingo': { lat: -0.2542, lng: -79.1719 },
  manta: { lat: -0.9677, lng: -80.7089 },
  loja: { lat: -3.9931, lng: -79.2042 },
  riobamba: { lat: -1.6636, lng: -78.6546 },
};

function citySlug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Resuelve coordenadas de una ciudad: primero el gazetteer local, luego
 * Nominatim como respaldo (puede fallar desde la nube).
 */
export async function geocodeCity(
  ciudad: string,
  pais = 'Ecuador',
): Promise<{ lat: number; lng: number } | null> {
  const local = CITY_COORDS[citySlug(ciudad)];
  if (local) return local;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
      `${ciudad}, ${pais}`,
    )}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const data = (await res.json()) as { lat: string; lon: string }[];
    if (!data.length) return null;
    return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
  } catch {
    return null;
  }
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
  const { lat, lng, max } = opts;
  // Solo `node` (no nwr): las vías/relaciones hacen que la consulta se agote en
  // radios grandes. Los nodes cubren la mayoría de los POI y son mucho más
  // rápidos. Radio acotado para no reventar el timeout del servidor público.
  const radio = Math.min(opts.radio || 8000, 12000);
  const q = `[out:json][timeout:90];
(
  node(around:${radio},${lat},${lng})[shop][name];
  node(around:${radio},${lat},${lng})[amenity~"${AMENITIES}"][name];
  node(around:${radio},${lat},${lng})[craft][name];
  node(around:${radio},${lat},${lng})[office][name];
);
out tags ${Math.min(max, 200)};`;

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: `data=${encodeURIComponent(q)}`,
  });
  if (!res.ok) throw new Error(`Overpass respondió ${res.status}`);
  const data = (await res.json()) as { elements?: OsmElement[]; remark?: string };

  // Overpass devuelve 200 con "remark" cuando la consulta se agota/errores.
  if (data.remark && (!data.elements || data.elements.length === 0)) {
    throw new Error(`Overpass: ${data.remark}`);
  }
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
