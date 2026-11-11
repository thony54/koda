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
    'bar_and_grill', 'meal_takeaway', 'sandwich_shop',
  ],
  cafe_bar: [
    'cafe', 'bar', 'pub', 'ice_cream', 'nightclub', 'biergarten', 'coffee_shop', 'cafeteria',
    'heladeria', 'discoteca', 'cafe bar', 'ice_cream_shop', 'tea_house',
  ],
  belleza: [
    'hairdresser', 'beauty', 'barber', 'barber_shop', 'hair_salon', 'nail_salon', 'spa', 'massage',
    'tattoo', 'cosmetics', 'peluqueria', 'barberia', 'estetica', 'salon de belleza', 'manicure',
    'beauty_salon', 'hair_care',
  ],
  salud: [
    'pharmacy', 'clinic', 'dentist', 'doctors', 'veterinary', 'hospital', 'optician',
    'physiotherapist', 'laboratory', 'medical_supply', 'farmacia', 'clinica', 'dentista',
    'veterinaria', 'consultorio medico', 'odontologia', 'optica', 'medico',
    'doctor', 'medical_clinic', 'dental_clinic', 'medical_center', 'medical_lab', 'general_hospital',
    'veterinary_care',
  ],
  gimnasios: [
    'fitness_centre', 'sports_centre', 'dance', 'gym', 'yoga', 'gimnasio', 'crossfit', 'pilates',
    'academia de baile', 'fitness_center', 'yoga_studio', 'sports_club',
  ],
  hoteles: [
    'hotel', 'guest_house', 'hostel', 'motel', 'apartment', 'hospedaje', 'hostal', 'residencial',
    'lodging', 'bed_and_breakfast', 'inn', 'resort_hotel',
  ],
  tiendas: [
    'supermarket', 'convenience', 'clothes', 'shoes', 'bakery', 'butcher', 'florist', 'jewelry',
    'mobile_phone', 'electronics', 'furniture', 'hardware', 'gift', 'toys',
    'department_store', 'mall', 'variety_store', 'bag', 'boutique', 'kiosk', 'bicycle', 'sports',
    'greengrocer', 'alcohol', 'pet', 'stationery', 'computer', 'tienda', 'tienda online',
    'ferreteria', 'panaderia', 'supermercado', 'ropa', 'zapateria', 'joyeria',
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
    'accounting', 'insurance_agency', 'consultant',
  ],
  // Los tres últimos corresponden a las plantillas Artista, Sublimados y Estándar de Connexo.
  // Solo reciben categorías que antes no tenían grupo: no cambian cómo se clasifica lo ya existente.
  musicos: [
    'music_school', 'musical_instrument', 'music_store', 'recording_studio', 'musico', 'musicos', 'banda',
    'grupo musical', 'dj', 'orquesta', 'mariachi', 'cantante', 'artista', 'escuela de musica',
    'estudio de grabacion', 'tienda de instrumentos', 'productora musical', 'musical_instrument_store',
  ],
  sublimados: [
    'copyshop', 'printer', 'printing', 'print_shop', 'embroiderer', 'fabric', 'sublimacion', 'sublimados',
    'serigrafia', 'estampados', 'bordados', 'imprenta', 'uniformes', 'textil', 'regalos personalizados',
    'copiadora', 'rotulos', 'gigantografia',
  ],
  // Plantilla Librería de Connexo (books). Antes «books» y «libreria» caían en tiendas (plantilla Ecommerce): ya no.
  librerias: [
    'book_store', 'bookstore', 'book_shop', 'books', 'libreria', 'librerias', 'libros', 'libreria papeleria',
  ],
  profesionales: [
    'photographer', 'photographic_laboratory', 'psychotherapist', 'psychologist', 'therapist', 'coach', 'coaching',
    'tutor', 'translator', 'nutritionist', 'fotografo', 'fotografia', 'estudio fotografico', 'psicologo',
    'psicologa', 'nutricionista', 'traductor', 'diseno grafico', 'freelance', 'consultor', 'profesor particular',
    'clases particulares', 'wedding_planner', 'photography_studio',
  ],
};

const POR_VALOR = new Map<string, string>();
for (const [grupo, valores] of Object.entries(GRUPOS)) {
  for (const v of valores) if (!POR_VALOR.has(norm(v))) POR_VALOR.set(norm(v), grupo);
}

// Google nombra muchos tipos de restaurante con el sufijo «_restaurant» (peruvian_restaurant,
// seafood_restaurant…) y de tienda con «_store» (clothing_store, jewelry_store…).
const ES_RESTAURANTE = /(^| )restaurants?$/;
const ES_TIENDA = /(^| )store$/;

// Cuando Google (o un CSV) pone un tipo genérico —«manufacturer», «service», «establishment»…— la categoría
// no dice el nicho, pero el NOMBRE casi siempre sí («Imprenta Quantica», «Quik Print»). Solo se consulta si la
// categoría no se reconoció. El orden importa: gana la primera que coincide.
// Fotógrafos (incluye los que Google nombra en inglés: «Wedding Photographer», «Photostudio»), psicólogos, nutricionistas y coaches.
const PISTA_PROFESIONALES = /fotograf|photograph|photo ?studio|psicolog|nutricion|nutriolog|dietist|\bcoach\b/;
// Tipos genéricos que Google pone a un profesional independiente (un nutricionista sale como «consultant»): si el NOMBRE
// dice su oficio, manda el nombre y no la categoría (si no, un nutricionista recibiría la plantilla de Ecommerce).
const CATEGORIAS_GENERICAS = new Set(['consultant', 'consulting', 'company', 'office', 'corporate office', 'service', 'establishment']);

const PISTAS_DE_NOMBRE: [string, RegExp][] = [
  ['sublimados', /imprent|print|sublim|serigraf|estampad|gigantograf|rotulo|copiad|bordad/],
  ['librerias', /libreria|\blibros\b|bookstore|bookshop/],
  ['musicos', /\bmusic|sonido|grabacion|mariachi|orquesta|\bdj\b|conservatorio|rockademia|escuela de rock/],
  ['profesionales', PISTA_PROFESIONALES],
  ['belleza', /barber|peluquer|salon de belleza|centro de estetica|\bnails?\b|manicur|\bspa\b/],
  ['salud', /clinica|consultorio|dental|odontolog|\bmedic|laboratorio clinico/],
  ['gimnasios', /\bgym\b|gimnasio|fitness|crossfit/],
  ['hoteles', /\bhotel|hostal|hosteria|hospedaje/],
  ['restaurantes', /restaurante|parrilla|picanteria|marisqueria|cevicheria|asadero|pizzeria/],
  ['cafe_bar', /cafeteria|\bcafe\b|coffee|heladeria|\bbar\b/],
];

/**
 * Grupo de rubro de una categoría (OSM / Google / texto libre), o null si no se reconoce.
 * Si se pasa el `nombre` del negocio, se usa como respaldo cuando la categoría es genérica.
 *
 * Las librerías («book_store», «books»…) tienen su propio rubro (`librerias` → plantilla Librería de Connexo) y
 * NO caen en «tiendas»: a cada negocio, la plantilla de su nicho.
 */
export function rubroDe(categoria: string | null | undefined, nombre?: string | null): string | null {
  if (categoria) {
    const n = norm(categoria);
    if (nombre && CATEGORIAS_GENERICAS.has(n) && PISTA_PROFESIONALES.test(norm(nombre))) return 'profesionales';
    const directo = POR_VALOR.get(n);
    if (directo) return directo;
    if (ES_RESTAURANTE.test(n)) return 'restaurantes';
    if (ES_TIENDA.test(n)) return 'tiendas';
  }
  if (nombre) {
    const nn = norm(nombre);
    for (const [grupo, re] of PISTAS_DE_NOMBRE) if (re.test(nn)) return grupo;
  }
  return null;
}
