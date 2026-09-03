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

// ── Rubros (categorías) → filtros de tags de OSM ────────────────────────────
// Cada rubro que el usuario elige en la búsqueda se traduce a uno o varios
// filtros de OSM. Así "restaurantes" trae SOLO restaurantes y no todo el mapa.
// La clave (p. ej. 'restaurantes') es la que se guarda en search_jobs.categorias.
export const RUBRO_TAGS: Record<string, string[]> = {
  restaurantes: ['amenity~"restaurant|fast_food"'],
  cafe_bar: ['amenity~"cafe|bar|pub|ice_cream|nightclub"'],
  belleza: ['shop~"hairdresser|beauty"', 'craft~"hairdresser"'],
  salud: ['amenity~"pharmacy|clinic|dentist|doctors|veterinary"'],
  gimnasios: ['leisure~"fitness_centre|sports_centre|dance"'],
  hoteles: ['tourism~"hotel|guest_house|hostel|motel"'],
  tiendas: ['shop'],
  talleres: ['craft', 'amenity~"car_wash|car_rental|driving_school|internet_cafe"'],
  oficinas: ['office'],
};

// Conjunto por defecto cuando el job no especifica rubros: todo lo anterior.
const DEFAULT_FILTERS = Object.values(RUBRO_TAGS).flat();

/**
 * Busca negocios alrededor de un punto. Devuelve elementos crudos de Overpass.
 * @param categorias rubros elegidos (claves de RUBRO_TAGS). Vacío = todos.
 * @param max límite de resultados.
 */
export async function overpassSearch(opts: {
  lat: number;
  lng: number;
  radio: number;
  max: number;
  categorias?: string[];
}): Promise<RawPlace[]> {
  const { lat, lng, max } = opts;
  // Solo `node` (no nwr): las vías/relaciones hacen que la consulta se agote en
  // radios grandes. Los nodes cubren la mayoría de los POI y son mucho más
  // rápidos. Radio acotado para no reventar el timeout del servidor público.
  const radio = Math.min(opts.radio || 8000, 12000);

  // Filtros según los rubros elegidos; si no hay ninguno, se buscan todos.
  const chosen = (opts.categorias ?? []).flatMap((r) => RUBRO_TAGS[r] ?? []);
  const filters = chosen.length ? chosen : DEFAULT_FILTERS;
  const nodeLines = filters
    .map((f) => `  node(around:${radio},${lat},${lng})[${f}][name];`)
    .join('\n');

  const q = `[out:json][timeout:90];
(
${nodeLines}
);
out tags ${Math.min(max, 200)};`;

  const data = await overpassFetch(q);

  // Overpass devuelve 200 con "remark" cuando la consulta se agota/errores.
  if (data.remark && (!data.elements || data.elements.length === 0)) {
    throw new Error(`Overpass: ${data.remark}`);
  }
  return (data.elements ?? []).slice(0, max).map((el) => ({
    external_id: `osm:${el.type}/${el.id}`,
    payload: el as unknown as Record<string, unknown>,
  }));
}

// Mirrors públicos de Overpass. El principal (overpass-api.de) es el más saturado
// y suele devolver 429 desde IPs de datacenter; probamos alternativas en orden.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ejecuta una consulta Overpass con tolerancia a rate-limit: ante 429/504
 * espera (respetando Retry-After si viene) y reintenta; si un endpoint sigue
 * fallando, pasa al siguiente mirror. Lanza solo si todos se agotan.
 */
async function overpassFetch(q: string): Promise<{ elements?: OsmElement[]; remark?: string }> {
  let ultimoError = 'Overpass no respondió';
  for (const url of OVERPASS_ENDPOINTS) {
    for (let intento = 0; intento < 2; intento++) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
          body: `data=${encodeURIComponent(q)}`,
        });
      } catch (e) {
        ultimoError = `Overpass ${url}: ${e instanceof Error ? e.message : String(e)}`;
        break; // problema de red con este mirror: pasa al siguiente
      }
      if (res.ok) return (await res.json()) as { elements?: OsmElement[]; remark?: string };

      ultimoError = `Overpass respondió ${res.status}`;
      // 429 (rate limit) o 504 (gateway/timeout): esperar y reintentar el mismo mirror.
      if (res.status === 429 || res.status === 504) {
        const ra = Number(res.headers.get('retry-after'));
        const espera = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 10) : 2 * (intento + 1);
        await sleep(espera * 1000);
        continue;
      }
      break; // otros errores: no insistir con este mirror
    }
  }
  throw new Error(ultimoError);
}

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
