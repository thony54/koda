// Rubros (grupos de negocio) que el usuario elige en "Mi espacio" y en Búsquedas.
// Las claves de grupo son las mismas de RUBRO_TAGS (sources/osm.ts) y de
// src/lib/rubros.ts en el front. Aquí está la tabla inversa: dado el `categoria`
// de un prospecto (valor OSM, tipo de Google o texto de un CSV) devuelve su grupo.

export const norm = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();

const GRUPOS: Record<string, string[]> = {
  restaurantes: [
    'restaurant', 'fast_food', 'food_court', 'bbq', 'pizzeria', 'restaurante', 'restaurantes',
    'comida rapida', 'picanteria', 'asadero', 'marisqueria', 'cevicheria', 'gastronomia',
  ],
  cafe_bar: [
    'cafe', 'bar', 'pub', 'ice_cream', 'nightclub', 'biergarten', 'coffee_shop', 'cafeteria',
    'heladeria', 'discoteca', 'cafe bar',
  ],
  belleza: [
    'hairdresser', 'beauty', 'barber', 'barber_shop', 'hair_salon', 'nail_salon', 'spa', 'massage',
    'tattoo', 'cosmetics', 'peluqueria', 'barberia', 'estetica', 'salon de belleza', 'manicure',
  ],
  salud: [
    'pharmacy', 'clinic', 'dentist', 'doctors', 'veterinary', 'hospital', 'optician',
    'physiotherapist', 'laboratory', 'medical_supply', 'farmacia', 'clinica', 'dentista',
    'veterinaria', 'consultorio medico', 'odontologia', 'optica', 'medico',
  ],
  gimnasios: [
    'fitness_centre', 'sports_centre', 'dance', 'gym', 'yoga', 'gimnasio', 'crossfit', 'pilates',
    'academia de baile',
  ],
  hoteles: [
    'hotel', 'guest_house', 'hostel', 'motel', 'apartment', 'hospedaje', 'hostal', 'residencial',
  ],
  tiendas: [
    'supermarket', 'convenience', 'clothes', 'shoes', 'bakery', 'butcher', 'florist', 'jewelry',
    'mobile_phone', 'electronics', 'furniture', 'hardware', 'books', 'gift', 'toys',
    'department_store', 'mall', 'variety_store', 'bag', 'boutique', 'kiosk', 'bicycle', 'sports',
    'greengrocer', 'alcohol', 'pet', 'stationery', 'computer', 'tienda', 'tienda online',
    'ferreteria', 'libreria', 'panaderia', 'supermercado', 'ropa', 'zapateria', 'joyeria',
    'floristeria', 'carniceria', 'minimarket',
  ],
  talleres: [
    'car_wash', 'car_rental', 'driving_school', 'internet_cafe', 'car_repair', 'tyres', 'mechanic',
    'carpenter', 'electrician', 'plumber', 'tailor', 'locksmith', 'painter', 'welder', 'taller',
    'mecanica', 'lubricadora', 'sastreria', 'carpinteria', 'cerrajeria',
  ],
  oficinas: [
    'office', 'estate_agent', 'real_estate_agency', 'lawyer', 'accountant', 'insurance', 'company',
    'coworking', 'architect', 'notary', 'it', 'consulting', 'advertising_agency', 'inmobiliaria',
    'abogado', 'contador', 'estudio juridico', 'agencia', 'oficina',
  ],
};

const POR_VALOR = new Map<string, string>();
for (const [grupo, valores] of Object.entries(GRUPOS)) {
  for (const v of valores) if (!POR_VALOR.has(norm(v))) POR_VALOR.set(norm(v), grupo);
}

/** Grupo de rubro de una categoría (OSM / Google / texto libre), o null si no se reconoce. */
export function rubroDe(categoria: string | null | undefined): string | null {
  if (!categoria) return null;
  return POR_VALOR.get(norm(categoria)) ?? null;
}
