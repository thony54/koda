// Motor de RECUERDO del agente de la Bandeja (migración 0018).
//
// Sin IA y sin costo: contesta con lo que Connexo YA sabe y con lo que el propietario YA respondió. Hay un BANCO de respuestas
// (cada entrada trae las frases con que la gente la pregunta, sus variantes de redacción, la acción a tomar y su historial de
// aciertos). Ante un mensaje, busca la entrada que mejor encaja, la personaliza (rubro, etapa de la demo, nombre) y le pone un
// cierre que lleva al siguiente paso. Lo que no reconoce NO lo inventa: se lo deja al propietario con una nota.
//
// Aprende para siempre: lo que el propietario envía (editado o escrito por su cuenta) vuelve al banco como variante o como
// entrada nueva, y cada borrador que aprueba sin cambios le sube la confianza a su entrada (con 3 seguidos sin cambios, esa
// respuesta puede ir en automático).
//
// Puro (sin Deno ni Supabase) para probarlo con Node. Los controles de seguridad del texto final (sin emojis, precios, enlaces,
// largo) los pone waAgente.ts con `revisarRespuesta`, igual que con el modelo.
import type { ContextoAgente } from './waAgente.ts';

// ── Tipos ───────────────────────────────────────────────────────────────────

export type AccionBanco = 'responder' | 'traspasar' | 'omitir';
export type OrigenBanco = 'fabrica' | 'aprendida' | 'manual';
export interface VarianteBanco { t: string; o: OrigenBanco }
export interface EntradaBanco {
  id: string;
  clave?: string | null;
  titulo: string;
  intencion: string;
  accion: AccionBanco;
  /** Frases con las que la gente pregunta esto (lo que se compara con el mensaje del cliente). */
  disparadores: string[];
  /** Palabras que, si aparecen en el mensaje, restan: «precio» no es lo mismo que «descuento». */
  excluye?: string[];
  respuestas: VarianteBanco[];
  /** Etapas de la demo (estado del envío) en que aplica; null = todas. */
  estados?: string[] | null;
  /** Agregar al final el paso siguiente (tocar el botón, entrar a su perfil…). */
  cierre: boolean;
  /** Para «traspasar»: lo que se le dice al propietario. */
  nota?: string | null;
  verificada: boolean;
  activo: boolean;
  origen?: OrigenBanco;
  usos?: number;
  aprobados: number;
  editados: number;
  descartes: number;
}

// ── Normalización del texto ─────────────────────────────────────────────────

/** Minúsculas, sin tildes ni signos, sin letras repetidas de más («holaaa», «siiii»). */
export function normalizar(s: string): string {
  let t = String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  t = t.replace(/https?:\/\/\S+/g, ' url ');
  t = t.replace(/[^a-z0-9]+/g, ' ');
  t = t.replace(/(.)\1{2,}/g, '$1').replace(/([aiu])\1/g, '$1');
  return t.replace(/\s+/g, ' ').trim();
}

// Expresiones que valen como UNA sola idea. Se reemplazan por una palabra clave antes de partir el texto.
const FRASES: [RegExp, string][] = [
  // Un «sí» solo (o «sí, por favor», «sí claro»): una afirmación. Un «si» dentro de otra frase es condicional y no cuenta.
  [/^(si|sip|si si|si claro|claro que si|si por favor|si dale|si gracias|bueno si|ok si)$/, ' afirma '],
  [/^cuanto (es|seria|sale)$/, ' cuanto precio '],
  [/^ya$/, ' ok '],
  [/\b(esta|muy|queda|todo) bien\b/g, ' ok '],
  [/\ba ver\b/g, ' '],
  [/\bno (me|nos) interes\w*|\bno (estoy|estamos|andamos) interesad\w*|\bno (necesito|necesitamos|requiero|requerimos|quiero|queremos)\b(?! que (me|nos))(?! (seguir )?(recibir|recibiendo))|\bno gracias\b|\bpor (el momento|ahora) no\b|\bno por (el momento|ahora)\b|\bahora no\b|\bgracias pero no\b|(?<!\bsi )\bno (nos|me) sirve\b|\bno (lo|la|los|las) (necesito|necesitamos|quiero|queremos)\b/g, ' rechazo '],
  [/\b(borr|elimin|saqu)\w* ?(me|nos)? (de|a)( la| su| sus| esa| esta)? (lista|listas|base|registro)\b|\bborren ?me\b|\bya basta( de (mensajes|mensaje|escribir|molestar))?\b|\bbasta de (mensajes|mensaje|escribir|molestar)\b|\bno (quiero|queremos|deseo|deseamos) (seguir )?(recibir|recibiendo)\b|\bbloque\w+ (mi|nuestro) (numero|contacto)\b|\bno (quiero|queremos) que (me|nos) (escriban|escribas|molesten|contacten|llamen|manden|envien|sigan)\b|\b(no|ya no) (me|nos) (escriban|escribas|molesten|molestes|contacten|contactes|envien|envies|manden|mandes|llamen|llames)( mas)?\b|\b(dejen|dejar|deja|dejes) de (escribir|molestar|enviar|mandar|contactar)( ?me| ?nos)?\b|\b(borr|elimin|saqu|quit)\w* (mi|nuestro) (numero|contacto|telefono)\b|\bdarme de baja\b|\bdarnos de baja\b|\bstop\b|\bbaja\b/g, ' baja '],
  [/\b(en un|a un|para un) futuro\b|\bmas adelante\b|\bmas tarde\b|\bluego (te|le|les) (aviso|escribo|contacto|confirmo|digo)\b|\bdespues (te|le|les) (aviso|escribo|contacto|confirmo|digo)\b|\b(yo )?(te|le|les) aviso\b|\ben otro momento\b|\bahorita no puedo\b|\bestoy ocupad\w+\b/g, ' luego '],
  [/\b(lo|la) (voy a|vamos a|quiero|queremos)? ?(pensar|pensarlo|consultar|consultarlo|vere|ver mas)\b|\bdejame (pensar|pensarlo|verlo|revisarlo|consultarlo|consultar)\b|\blo (veo|consulto|pienso) (con|luego|despues|mas tarde)\b|\blo (consulto|pienso)\b/g, ' luego '],
  [/\bya (lo|la) (reviso|veo|vi|revise)\b|\blo reviso\b/g, ' yarevise '],
  [/\b(quiero|quisiera|necesito|puedo|podria|puede|pueden|podrian|podemos|queremos|quisieramos) (hablar|comunicarme|comunicarnos|conversar)\b/g, ' quierehablar '],
  [/\bcuanto (cuesta|cuestan|vale|valen|sale|salen|cobran|cobra|costaria|seria|es el|es la|es lo|tengo que pagar|se paga|pagaria|pago)\b/g, ' cuanto precio '],
  [/\b(sin|gratis) (costo|cargo|pagar|cobro|tarjeta)\b|\bno (cobran|cuesta|se paga)\b/g, ' gratis '],
  [/\b(por|al|cada|todos los|todo el|un) mes(es)?\b|\bmensual(es|idad|idades|mente)?\b|\bmes a mes\b/g, ' mensual '],
  [/\b(por|al|cada|todos los|todo el|un) ano(s)?\b|\banual(es|mente)?\b|\bun solo pago\b|\bpago unico\b/g, ' anual '],
  [/\bpaginas? web\b|\bsitios? web\b|\bweb ?sites?\b|\bpagina\b|\bsitio\b/g, ' web '],
  [/\bredes sociales\b|\bredes\b|\bred social\b/g, ' redes '],
  // «¿eres una persona?» / «¿esto es automático?» es UNA pregunta; «cuántas personas» no lo es.
  [/\b(eres|es|sos|son|seran) (una |un )?(persona|humano|humana|robot|bot|maquina|chatbot)\b|\b(hablo|hablando|estoy hablando|estamos hablando) con (una |un )?(persona|humano|humana|robot|bot|maquina)\b|\bes (automatico|automatica|automatizado)\b/g, ' preguntabot '],
  [/\binteligencia artificial\b|\bchat ?gpt\b|\bchatbot\b/g, ' ia '],
  [/\bya (tengo|tenemos|cuento con|contamos con|manejo|manejamos|uso|usamos|hice|hicimos)\b/g, ' yatengo '],
  [/\b(no|ni) (tengo|tenemos|uso|usamos|manejo|tiene|tienen|usa|usan)\b/g, ' notengo '],
  // «tengo un sitio hecho en wordpress» = ya tiene página (va DESPUÉS de «ya tengo» y «no tengo», que ya consumieron esas frases).
  [/\b(tengo|tenemos|hice|hicimos|manejo|manejamos) (un|una|mi|mis|nuestra|nuestro)? ?(pagina|sitio|web|website)\b/g, ' yatengo web '],
  [/\bno soy (yo|el|la|ese|esa|quien)\b|\bse equivoc\w+\b|\bequivocad[oa]\b|\bno es (mi|este|el) negocio\b|\bya no tengo (el|mi) negocio\b|\bcerramos (el|nuestro) negocio\b/g, ' equivocado '],
  [/\bquien(es)? (eres|es usted|son ustedes|son|habla|me escribe|escribe|es connexo)\b|\bde parte de quien\b|\bcon quien (hablo|estoy hablando|estamos hablando)\b|\b(de|que) empresa (es|son|eres)\b|\bcomo se llama (la|su) empresa\b/g, ' quieneres '],
  [/\bdonde (estan|quedan|se ubican)\b|\btienen (local|oficina|oficinas|sucursal en)\b/g, ' ubicacionconnexo '],
  [/\bpara que (me )?sirve\b|\bque (utilidad|uso) tiene\b/g, ' parasirve '],
  [/\bque hacen( ustedes)?\b|\ba que se dedican\b|\bque es lo que hacen\b/g, ' quehacen '],
  [/\b(com|www|net|org)\b/g, ' dominio '],
  [/\bque (es|son|seria) (esto|eso|esa cosa|este mensaje|lo que me (mandan|enviaron|mandaron))\b|\bque (me|nos) (mandan|enviaron|mandaron)\b|\bno (se|sabia|entiendo) (que|de que) (es|se trata)( esto| eso)?\b|\b(recibi|me llego|me llegaron|me mandaron|me enviaron) (un|el|este) mensaje\b/g, ' queeseso '],
  [/\bquiero (ver|verlo|verla|mirar)\b|\bmuestr(a|e)(me|nos)?\b/g, ' ver demo '],
  // Interés de verdad: «me interesa», «quiero probarlo», «sí, me gustaría». «Si quiero que me devuelvan…» o «me gustaría saber…» NO lo son.
  [/\bsi (me )?(gustaria|interesa|por favor|claro|dale)\b|\bsi quiero\b(?! (que|saber|cancelar|preguntar|consultar|ver que))|\bme interesa\b|\bme gustaria\b(?! (saber|conocer|preguntar|consultar|averiguar|que|cuanto|como|si|cual|cuales|donde|cuando|tener informacion|informacion))|\bestoy interesad\w+\b|\bestamos interesad\w+\b|\b(quiero|quisiera|queremos|quisieramos|voy a|vamos a|podemos|puedo)( mucho)? (probar|probarlo|probarla|activar|activarlo|activarla|empezar|contratar)\b/g, ' interes '],
  [/\b(otro|otros|mas de un|segundo|otra) (negocio|local|sucursal)\b|\b(\d+|dos|tres|cuatro|cinco|varios|varias|muchos|muchas) (negocios|locales|sucursales|tiendas)\b/g, ' variosnegocios '],
  [/\bde donde (sacaron|obtuvieron|consiguieron|tienen|sacan)\b|\bcomo (consiguieron|obtuvieron|sacaron|tienen) (mi|nuestro)\b|\bquien (les|te) dio (mi|nuestro)\b/g, ' consiguieron numero '],
];

/** Abreviaturas de WhatsApp. (Map: una palabra como «constructor» no debe tropezar con el prototipo de un objeto.) */
const ABREV = new Map<string, string>(Object.entries({
  q: 'que', k: 'que', xq: 'porque', pq: 'porque', porq: 'porque', x: 'por', d: 'de', tb: 'tambien', tmb: 'tambien', xfa: 'favor',
  pfv: 'favor', pf: 'favor', porfa: 'favor', bn: 'bien', dnd: 'donde', cmo: 'como', cm: 'como', cnt: 'cuanto', ntp: 'no',
  info: 'informacion', infos: 'informacion', msj: 'mensaje', ws: 'whatsapp', wsp: 'whatsapp', wpp: 'whatsapp', whats: 'whatsapp',
  insta: 'instagram', ig: 'instagram', fb: 'facebook', face: 'facebook', tik: 'tiktok',
}));

/** Palabras distintas con el mismo sentido: se reducen a una sola. */
const GRUPOS: Record<string, string[]> = {
  precio: ['precio', 'precios', 'valor', 'valores', 'costo', 'costos', 'cuesta', 'cuestan', 'tarifa', 'tarifas', 'costar', 'costaria', 'pricing', 'presupuesto', 'inversion'],
  cobro: ['cobran', 'cobra', 'cobro', 'cobros', 'cobrar', 'cobrarme', 'cobrarnos'],
  regatear: ['negociar', 'negociacion', 'negociable', 'regatear'],
  gratis: ['gratis', 'gratuito', 'gratuita', 'regalo', 'free'],
  web: ['web', 'website', 'sitio', 'pagina'],
  pago: ['pagar', 'pago', 'pagos', 'paga', 'pagan', 'pagas', 'pagare', 'pagaria', 'pague', 'abonar', 'abono'],
  // (sin «lista», «bien» ni «ya» sueltos: «borrenme de su lista» o «explícame bien» no son un acuse de recibo)
  ok: ['ok', 'oki', 'okey', 'okay', 'okk', 'okis', 'listo', 'entiendo', 'entendido', 'entendida', 'comprendido', 'enterado', 'enterada', 'anotado', 'comprendo', 'perfecto', 'perfecta', 'excelente', 'genial', 'bueno', 'buenisimo', 'vale', 'super'],
  demo: ['demo', 'demostracion', 'ejemplo', 'ejemplos', 'muestra', 'muestras', 'vista'],
  probar: ['probar', 'prueba', 'probarlo', 'probarla', 'pruebo', 'probando', 'testear', 'testeo', 'piloto'],
  activar: ['activar', 'activo', 'activa', 'activala', 'activalo', 'activacion', 'habilitar', 'habilita'],
  empezar: ['empezar', 'empezamos', 'empecemos', 'iniciar', 'inicio', 'comenzar', 'comencemos', 'arrancar', 'arrancamos'],
  interes: ['interesa', 'interesan', 'interesado', 'interesada', 'interesados', 'interes', 'encanta', 'dale', 'adelante'],
  editar: ['cambiar', 'cambio', 'cambios', 'modificar', 'modifico', 'editar', 'edito', 'edicion', 'actualizar', 'actualizo', 'actualiza', 'personalizar'],
  dominio: ['dominio', 'dominios'],
  nfc: ['nfc', 'pulsera', 'pulseras', 'chip'],
  qr: ['qr'],
  contactohumano: ['persona', 'humano', 'humana', 'asesor', 'asesora', 'agente', 'ejecutivo', 'ejecutiva', 'vendedor', 'vendedora'],
  bot: ['bot', 'robot', 'maquina', 'automatico', 'automatica', 'automatizado'],
  descuento: ['descuento', 'descuentos', 'rebaja', 'rebajas', 'rebajan', 'rebajen', 'rebajame', 'rebajarme', 'promocion', 'promociones', 'oferta', 'ofertas', 'cupon', 'barato', 'barata', 'economico', 'economica', 'rebajar'],
  caro: ['caro', 'cara', 'costoso', 'costosa', 'elevado', 'carisimo', 'carisima', 'costosisimo', 'costosisima'],
  computadora: ['compu', 'computadora', 'computador', 'pc', 'laptop', 'portatil'],
  factura: ['factura', 'facturas', 'facturan', 'facturacion', 'ruc', 'sri', 'retencion'],
  contrato: ['contrato', 'contratos', 'permanencia', 'clausula', 'compromiso'],
  cancelar: ['cancelar', 'cancelo', 'cancelacion', 'reembolso', 'reembolsar', 'devolucion', 'devolver', 'devuelvan', 'devuelvo', 'devuelve', 'devuelven', 'anular'],
  llamar: ['llamar', 'llamen', 'llamame', 'llamenme', 'llamada', 'llamadas', 'telefonear', 'telefono', 'numero'],
  estafa: ['estafa', 'estafadores', 'fraude', 'engano', 'enganos', 'timo', 'phishing', 'sospechoso', 'sospechosa'],
  seguro: ['seguro', 'segura', 'confiable', 'confianza', 'respaldo', 'garantia'],
  molesto: ['molesto', 'molesta', 'molestia', 'molestan', 'molestando', 'spam', 'acoso', 'denuncia', 'denunciar', 'reportar', 'bloquear', 'bloqueo', 'harto', 'harta', 'fastidio'],
  acceso: ['clave', 'contrasena', 'password', 'acceder', 'ingresar', 'entrar', 'login'],
  problema: ['problema', 'error', 'falla', 'fallo', 'fallando', 'bug', 'roto', 'dana', 'danado', 'funciona'],
  boton: ['boton', 'botones'],
  celular: ['celular', 'movil', 'telefono'],
  app: ['app', 'aplicacion', 'apk', 'descargar', 'descarga', 'instalar', 'instala', 'instalo'],
  perdido: ['perdida', 'perdido', 'confundida', 'confundido', 'confuso', 'confusa', 'enredada', 'enredado'],
  catalogo: ['catalogo', 'carta', 'menu'],
  reserva: ['reserva', 'reservas', 'reservar', 'agenda', 'agendar', 'cita', 'citas', 'turno', 'turnos'],
  pedido: ['pedido', 'pedidos', 'pedir', 'ordenes', 'orden', 'comanda', 'comandas', 'carrito', 'compra', 'compras', 'comprar'],
  analitica: ['analitica', 'analiticas', 'estadistica', 'estadisticas', 'metricas', 'visita', 'visitan', 'visitas', 'reportes', 'medir'],
  socio: ['socio', 'socia', 'jefe', 'esposo', 'esposa', 'gerente', 'duenos'],
  sucursal: ['sucursal', 'sucursales', 'local', 'locales', 'negocios'],
  fotos: ['foto', 'fotos', 'fotografia', 'fotografias', 'imagen', 'imagenes', 'portada', 'logo'],
};
const SINONIMO = new Map<string, string>();
for (const [canon, lista] of Object.entries(GRUPOS)) for (const p of lista) if (!SINONIMO.has(p)) SINONIMO.set(p, canon);
// Una palabra puede estar en dos grupos (telefono: llamar/celular): manda el primero declarado, salvo estas.
SINONIMO.set('telefono', 'llamar');
for (const w of ['funciona', 'funcionan', 'funcionar', 'funcionamiento']) SINONIMO.set(w, 'operar');   // «funciona en celular» no es un problema (ni se confunde con «funciones»)
SINONIMO.set('numero', 'numero');       // «mi número» (de dónde sacaron) no es «llamar»
SINONIMO.set('local', 'local');

/** Palabras sin carga: se ignoran tanto en las frases del banco como en lo que escribe el cliente. */
const PARADAS = new Set(`a al algo alguien algun alguna algunos algunas ante antes aqui asi aun aunque cada cual cuales con contra de del desde e el ella ellas ellos
en entre era eran eres es esa esas ese eso esos esta estaba estan estar estas este esto estos estoy estamos fue fui ha habia han hasta hay he la las le les lo los
me mi mis mucho mucha muchos muchas muy nada ni nos nosotros o os otra otro otros para pero poco por porque pues que se sea ser sido sin sobre solo son soy su sus
tambien te tendria tengo tenemos tiene tienes tienen todo toda si todos todas tu tus un una uno unos unas usted ustedes va vamos van vez voy y yo
hola buenas buenos buen dias dia tardes tarde noches noche saludos favor duda dudas pregunta preguntas consulta consultas quiero quisiera queremos queria
saber conocer puedo puede pueden podria podrian podrias necesito necesitamos ayuda ayudar ayudarme ayudarnos gustaria cuentame cuentenme decir dime digame
quedo queda quedaria sera seria seran eso esa asi tal vez ahi alla aca mismo misma tanto tanta bastante demasiado ver mirar vi vimos vio sido siendo mas
oh ah eh uh um mm jaja jajaja jeje jejeje`.split(/\s+/));
// «ya» y «bueno» pueden ser acuse de recibo: por eso no están en PARADAS sino en el grupo `ok`.
PARADAS.delete('ver');   // «ver demo» sí cuenta

const CONSERVAR_CORTAS = new Set(['si', 'no', 'ia', 'qr', 'ok', 'ya', 've']);

const SUFIJOS = [
  'amientos', 'imientos', 'amiento', 'imiento', 'aciones', 'uciones', 'acion', 'ucion', 'adores', 'adoras', 'ador', 'adora', 'ancias', 'encias', 'ancia', 'encia',
  'mente', 'ables', 'ibles', 'able', 'ible', 'ando', 'iendo', 'ados', 'adas', 'idos', 'idas', 'aron', 'ieron', 'aban', 'aran', 'eran', 'arlo', 'arla', 'erlo', 'erla',
  'irlo', 'irla', 'ado', 'ada', 'ido', 'ida', 'ara', 'era', 'ar', 'er', 'ir', 'an', 'en', 'as', 'es', 'os', 'a', 'e', 'o', 's',
].sort((a, b) => b.length - a.length);

function raiz(t: string): string {
  if (t.length <= 4) return t;
  for (const s of SUFIJOS) if (t.endsWith(s) && t.length - s.length >= 4) return t.slice(0, -s.length);
  return t;
}

// Errores de tecleo: una palabra que no existe pero está a un solo cambio de otra que sí conocemos («cuezta», «presio») se corrige.
const CONOCIDAS = new Map<string, string[]>();   // por primera letra: la búsqueda no recorre todo el diccionario
for (const k of SINONIMO.keys()) if (k.length >= 6) { const l = CONOCIDAS.get(k[0]) ?? []; l.push(k); CONOCIDAS.set(k[0], l); }
/** Cómo suena una palabra (para no confundir un error de escritura, «cuezta», con otra palabra que existe, «contar»). */
function sonido(s: string): string {
  return s.replace(/h/g, '').replace(/ll/g, 'y').replace(/qu/g, 'k').replace(/c(?=[aou])/g, 'k').replace(/c(?=[ei])/g, 's')
    .replace(/z/g, 's').replace(/v/g, 'b').replace(/g(?=[ei])/g, 'j').replace(/c/g, 'k');
}
/** ¿Es `w` la palabra `k` mal escrita? Misma pronunciación, dos letras cambiadas de lugar, o una letra repetida de más. */
function malEscrita(w: string, k: string): boolean {
  if (sonido(w) === sonido(k)) return true;
  if (w.length === k.length) { for (let i = 0; i < w.length - 1; i++) if (w[i] === k[i + 1] && w[i + 1] === k[i] && w.slice(0, i) + w.slice(i + 2) === k.slice(0, i) + k.slice(i + 2)) return true; }
  return w.length === k.length + 1 && [...w].some((_, i) => w.slice(0, i) + w.slice(i + 1) === k && w[i] === w[i - 1]);
}
function corregir(w: string): string {
  if (w.length < 6 || SINONIMO.has(w) || PARADAS.has(w)) return w;
  // Solo errores de escritura de verdad: «cuezta» → «cuesta», «presio» → «precio». Una palabra válida distinta («contar», «entran») no se toca.
  for (const k of CONOCIDAS.get(w[0]) ?? []) if (k !== w && k[k.length - 1] === w[w.length - 1] && malEscrita(w, k)) return k;
  return w;
}

// Las frases del banco se analizan una vez y se recuerdan (la función vive varias peticiones): mismo resultado, mucho menos trabajo.
const MEMORIA = new Map<string, string[]>();
const MEMORIA_MAX = 6000;

/** El texto convertido en ideas: palabras clave sin tildes, sin relleno, reducidas a su raíz y sin repetir. */
export function tokenizar(texto: string): string[] {
  const clave = String(texto ?? '');
  const guardado = clave.length <= 200 ? MEMORIA.get(clave) : undefined;
  if (guardado) return guardado.slice();
  const r = analizar(clave);
  if (clave.length <= 200) { if (MEMORIA.size >= MEMORIA_MAX) MEMORIA.clear(); MEMORIA.set(clave, r); }
  return r.slice();
}

function analizar(texto: string): string[] {
  // Primero las abreviaturas («q es esto» → «que es esto»), luego las frases hechas, y al final palabra por palabra.
  let t = normalizar(texto).split(' ').map((w) => ABREV.get(w) ?? w).join(' ');
  for (const [re, rep] of FRASES) t = t.replace(re, rep);
  const salida: string[] = [];
  for (let w of t.split(' ')) {
    if (!w) continue;
    w = corregir(w);
    const canon = SINONIMO.get(w);
    if (canon) w = canon;
    if (PARADAS.has(w)) continue;
    if (w.length <= 2 && !CONSERVAR_CORTAS.has(w)) continue;
    const r = raiz(w);
    if (!salida.includes(r)) salida.push(r);
  }
  return salida;
}

const RE_SALUDO = /\b(hola|holi|buenas|buenos dias|buen dia|buenas tardes|buenas noches|saludos|hello|hi|que tal|como estas|como esta)\b/;
const esSoloSaludo = (texto: string): boolean => RE_SALUDO.test(normalizar(texto)) && tokenizar(texto).length === 0;

// ── Parecido entre palabras (errores de tecleo) ─────────────────────────────

function distancia(a: string, b: string, tope: number): number {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function credito(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length; const lb = b.length;
  // Una raíz que es el comienzo de otra («cobra» / «cobran»). Con menos de 5 letras se confunden palabras distintas («vent» / «ventaj»).
  if (Math.min(la, lb) >= 5 && Math.abs(la - lb) <= 2 && (a.startsWith(b) || b.startsWith(a))) return 0.9;
  if (Math.min(la, lb) >= 5) {
    const lim = Math.max(la, lb) >= 9 ? 2 : 1;
    if (distancia(a, b, lim) <= lim) return 0.8;
  }
  return 0;
}

// ── Índice y búsqueda ───────────────────────────────────────────────────────

export const AJUSTE = {
  /** score = cobertura × (BASE + RESTO × especificidad) */
  base: 0.62, resto: 0.38,
  /** Peso de lo que el banco no conoce (relativo al peso de una palabra rara del banco). */
  desconocida: 0.5,
  /** Debajo de esto no se reconoce la pregunta: se deja al propietario. */
  media: 0.6,
  /** Desde aquí y con ventaja sobre la segunda, la coincidencia es «alta». */
  alta: 0.84,
  ventaja: 0.1,
  /** Para el modo automático. */
  auto: 0.8,
  ventajaAuto: 0.12,
  /** Para contestar una segunda pregunta del mismo mensaje. */
  segunda: 0.64,
  /** Se descuenta si la entrada no aplica a la etapa de la demo en que está el negocio. */
  etapaAjena: 0.6,
  /** Se descuenta por cada «excluye» presente. */
  excluida: 0.4,
};

interface IndiceEntrada { e: EntradaBanco; frases: { frase: string; toks: string[] }[]; excl: string[] }
export interface Indice { entradas: IndiceEntrada[]; idf: Map<string, number>; pesoDesconocido: number }

export function construirIndice(banco: EntradaBanco[]): Indice {
  const entradas: IndiceEntrada[] = [];
  const df = new Map<string, number>();
  for (const e of banco) {
    if (!e.activo || e.intencion === 'saludo') continue;   // los saludos se atienden aparte (sus palabras no pesan)
    const frases = (e.disparadores ?? []).map((frase) => ({ frase, toks: tokenizar(frase) })).filter((f) => f.toks.length > 0);
    if (!frases.length) continue;
    const vistos = new Set<string>();
    for (const f of frases) for (const t of f.toks) vistos.add(t);
    for (const t of vistos) df.set(t, (df.get(t) ?? 0) + 1);
    entradas.push({ e, frases, excl: (e.excluye ?? []).flatMap((x) => tokenizar(x)) });
  }
  const n = Math.max(entradas.length, 1);
  const idf = new Map<string, number>();
  for (const [t, c] of df) idf.set(t, Math.log(1 + n / c));
  return { entradas, idf, pesoDesconocido: Math.log(1 + n) * AJUSTE.desconocida };
}

export interface Candidato {
  entrada: EntradaBanco;
  puntaje: number;
  cobertura: number;
  especificidad: number;
  frase: string;
  /** Palabras del mensaje que explican la coincidencia. */
  cubiertos: string[];
}

function puntuarFrase(P: string[], M: string[], ix: Indice): { puntaje: number; cobertura: number; especificidad: number; cubiertos: string[] } {
  const peso = (t: string) => ix.idf.get(t) ?? ix.pesoDesconocido;
  let masaP = 0; let acierto = 0;
  const cub = new Map<string, number>();
  for (const t of P) {
    const w = peso(t); masaP += w;
    let mejor = 0; let quien = '';
    for (const m of M) { const c = credito(t, m); if (c > mejor) { mejor = c; quien = m; if (c === 1) break; } }
    acierto += w * mejor;
    if (mejor > 0) cub.set(quien, Math.max(cub.get(quien) ?? 0, mejor));
  }
  const cobertura = masaP ? acierto / masaP : 0;
  let masaM = 0; let explicada = 0;
  for (const m of M) { const w = peso(m); masaM += w; explicada += w * (cub.get(m) ?? 0); }
  const especificidad = masaM ? explicada / masaM : 0;
  return { puntaje: cobertura * (AJUSTE.base + AJUSTE.resto * especificidad), cobertura, especificidad, cubiertos: [...cub.keys()] };
}

/** Las entradas que encajan con el mensaje, de la mejor a la peor. */
export function buscarTokens(ix: Indice, M: string[], estado: string | null): Candidato[] {
  if (!M.length) return [];
  const salida: Candidato[] = [];
  for (const { e, frases, excl } of ix.entradas) {
    let mejor: ReturnType<typeof puntuarFrase> & { frase: string } | null = null;
    let buenas = 0;
    for (const f of frases) {
      const r = puntuarFrase(f.toks, M, ix);
      if (r.puntaje > 0.5) buenas++;
      if (!mejor || r.puntaje > mejor.puntaje) mejor = { ...r, frase: f.frase };
    }
    if (!mejor || mejor.puntaje <= 0) continue;
    let p = mejor.puntaje + Math.min(0.04, 0.02 * Math.max(0, buenas - 1));
    if (excl.length && excl.some((x) => M.some((m) => credito(x, m) >= 0.9))) p *= AJUSTE.excluida;
    if (estado && e.estados && e.estados.length) { if (e.estados.includes(estado)) p += 0.03; else p *= AJUSTE.etapaAjena; }
    // Una respuesta que el propietario descartó más veces de las que aprobó baja de puesto.
    p -= Math.min(0.25, 0.08 * Math.max(0, e.descartes - e.aprobados));
    // (sin tope en 1: la etapa exacta desempata entre dos coincidencias perfectas; pct() lo recorta al mostrarlo)
    salida.push({ entrada: e, puntaje: Math.max(0, Math.min(1.1, p)), cobertura: mejor.cobertura, especificidad: mejor.especificidad, frase: mejor.frase, cubiertos: mejor.cubiertos });
  }
  return salida.sort((a, b) => b.puntaje - a.puntaje);
}

export function buscar(banco: EntradaBanco[], texto: string, estado: string | null): { candidatos: Candidato[]; tokens: string[]; indice: Indice } {
  const indice = construirIndice(banco);
  const tokens = tokenizar(texto);
  return { candidatos: buscarTokens(indice, tokens, estado), tokens, indice };
}

// ── Personalización ─────────────────────────────────────────────────────────

/** Lo que cada plantilla de Connexo le da al negocio (sale del conocimiento de Connexo), dicho como «tus clientes …». */
export const BENEFICIOS: Record<string, string> = {
  default: 'ven quién eres, te escriben por WhatsApp y encuentran tus servicios, tus redes y tu ubicación en un solo enlace',
  barber: 'reservan con su barbero y juntan sellos en tu club de fidelidad',
  gastro: 'ven tu menú, hacen pedidos y los siguen con un código, y con el plan ULTRA hasta reservan mesa',
  petcare: 'piden citas con los datos de su mascota y compran del catálogo con despacho',
  medical: 'piden citas, ven tus servicios y tienen a mano tu botón de emergencia',
  ecom: 'arman su carrito, eligen entrega o retiro y siguen su pedido',
  stage: 'ven tus lanzamientos, tus fechas y tickets, y compran tu merch',
  realty: 'ven tus propiedades con galería, buscan por zona y contactan al asesor',
  sublima: 'ven tu catálogo con precios por volumen y piden cotización o muestra',
  gym: 'ven tus planes, tus clases con horario y tus entrenadores, y se inscriben con su carnet digital',
  hotel: 'ven tus habitaciones y la disponibilidad en vivo, y reservan directo',
  books: 'ven tu catálogo con stock, apartan ejemplares y encargan lo que no tienes',
  photo: 'ven tu portafolio, eligen un paquete y reservan su sesión con una agenda sin choques de horario',
};

export interface Variables { nombre?: string; negocio?: string; beneficio?: string; direccion?: string; enlace?: string }

const NO_NOMBRES = new Set(['barber', 'studio', 'estudio', 'cafe', 'tienda', 'hotel', 'hostal', 'clinica', 'libreria', 'papeleria', 'pet', 'vet', 'gym', 'fit', 'fitness', 'spa', 'salon', 'boutique', 'restaurante', 'bar', 'grill', 'foto', 'fotografia', 'dental', 'odonto', 'veterinaria', 'inmobiliaria', 'academia', 'escuela', 'centro', 'grupo', 'express', 'digital', 'nutricion', 'peluqueria', 'ferreteria', 'farmacia']);

function nombreDePila(perfil: string | null | undefined): string {
  const p = String(perfil ?? '').trim();
  if (!p || p.length > 40) return '';
  const primero = p.split(/\s+/)[0];
  if (!/^[A-ZÁÉÍÓÚÑ][a-záéíóúüñ]{2,13}$/.test(primero)) return '';           // «Ana», no «ANA», no «Studio1»
  if (NO_NOMBRES.has(normalizar(primero))) return '';
  if (/\d|[&@|/]/.test(p)) return '';
  return primero;
}

function nombreDeNegocio(...candidatos: (string | null | undefined)[]): string {
  for (const c of candidatos) {
    let t = String(c ?? '');
    t = t.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍]/gu, ' ');
    t = t.split(/\s[|/–—-]\s|\s*[|:•·]\s*/)[0] ?? t;
    t = t.replace(/\s+/g, ' ').trim();
    if (t.length >= 3 && t.length <= 36) return t;
  }
  return '';
}

export function variablesDe(ctx: ContextoAgente): Variables {
  const e = ctx.envio;
  const theme = e?.theme ?? null;
  const user = e?.username ?? null;
  return {
    nombre: nombreDePila(ctx.conversacion.nombre_perfil),
    negocio: nombreDeNegocio(e?.nombre, ctx.prospecto?.nombre, ctx.conversacion.negocio),
    beneficio: theme && Object.hasOwn(BENEFICIOS, theme) ? BENEFICIOS[theme] : BENEFICIOS.default,
    direccion: user ? `connexoapp.com/${user}` : '',
    // El enlace al perfil solo sirve cuando ya aceptó: antes de eso su perfil está inactivo y quien lo abra ve una cuenta inactiva.
    enlace: user && e?.estado === 'aceptado' ? `https://www.connexoapp.com/${user}` : '',
  };
}

const RE_MARCA = /\{(nombre|negocio|beneficio|direccion|enlace)\}/g;

/** Rellena las marcas. Una frase con una marca sin valor se omite entera (mejor callar que decir «tu dirección es .»). */
export function renderizar(plantilla: string, v: Variables): string | null {
  const frases = String(plantilla).split(/(?<=[.!?])\s+/);
  const salida: string[] = [];
  for (const f of frases) {
    let falta = false;
    const t = f.replace(RE_MARCA, (_, k: keyof Variables) => {
      const val = v[k];
      if (val) return val;
      if (k !== 'nombre') falta = true;
      return '';
    });
    if (falta) continue;
    salida.push(t.replace(/\s+([,.;:!?])/g, '$1').replace(/,\s*,/g, ',').replace(/^[\s,]+/, '').replace(/\s{2,}/g, ' ').trim());
  }
  const r = salida.filter(Boolean).join(' ').trim();
  return r || null;
}

// ── El cierre: el paso siguiente ────────────────────────────────────────────

const SIN_ACEPTAR = new Set(['borrador', 'aprobado', 'wa_enviado']);
const CIERRES = {
  sin_aceptar: [
    'Si quieres verlo con los datos de tu negocio, toca «¡Sí, enviar demo!» en el primer mensaje que te envié.',
    'Para verlo ya armado con tus datos, toca «¡Sí, enviar demo!» en el primer mensaje.',
    'Cuando quieras verlo, toca «¡Sí, enviar demo!» en el primer mensaje y te llega tu enlace al instante.',
  ],
  aceptado: [
    'Si algo no te cuadra al entrar, dime y lo vemos.',
    'Cuéntame qué quieres ajustar primero y te oriento.',
    'Cualquier duda con tu perfil, me escribes por aquí.',
  ],
  pausado: [
    'Si quieres retomarlo, me avisas por aquí.',
    'Cuando quieras verlo con tus datos, me dices y lo coordinamos.',
  ],
};

function grupoDeCierre(estado: string | null): keyof typeof CIERRES {
  if (estado === 'aceptado') return 'aceptado';
  if (estado === 'declinado' || estado === 'vencido' || estado === 'descartado') return 'pausado';
  return 'sin_aceptar';
}
export const etapaDe = (estado: string | null): 'sin_aceptar' | 'aceptado' | 'pausado' => grupoDeCierre(estado);
export const esSinAceptar = (estado: string | null): boolean => estado === null || SIN_ACEPTAR.has(estado);

// ── Elegir y armar el texto ─────────────────────────────────────────────────

const PESO_ORIGEN: Record<OrigenBanco, number> = { fabrica: 1, aprendida: 3, manual: 3 };

/** Entre las variantes aplicables, una al azar (las del propietario pesan el triple), sin repetir lo que ya se dijo en el chat. */
function elegirVariante(e: EntradaBanco, v: Variables, evitar: Set<string>, aleatorio: () => number): { texto: string; origen: OrigenBanco } | null {
  const todas = (e.respuestas ?? []).map((x) => ({ texto: renderizar(x.t, v), origen: x.o })).filter((x): x is { texto: string; origen: OrigenBanco } => !!x.texto);
  if (!todas.length) return null;
  // «Ya dicho» = el texto ya aparece dentro de algo que se envió o se propuso (que además lleva saludo y cierre).
  const yaDicho = (txt: string): boolean => { const nt = normalizar(txt); for (const d of evitar) if (d.includes(nt)) return true; return false; };
  const nuevas = todas.filter((x) => !yaDicho(x.texto));
  const pool = nuevas.length ? nuevas : todas;
  const total = pool.reduce((s, x) => s + PESO_ORIGEN[x.origen], 0);
  let r = aleatorio() * total;
  for (const x of pool) { r -= PESO_ORIGEN[x.origen]; if (r <= 0) return x; }
  return pool[pool.length - 1];
}

function saludoEspejo(textoCliente: string): string {
  const t = normalizar(textoCliente);
  if (/\bbuenos dias\b|\bbuen dia\b/.test(t)) return 'Buen día';
  if (/\bbuenas tardes\b/.test(t)) return 'Buenas tardes';
  if (/\bbuenas noches\b/.test(t)) return 'Buenas noches';
  if (/\bhola\b|\bholi\b|\bbuenas\b|\bsaludos\b/.test(t)) return 'Hola';
  return '';
}

/** Lo que el cliente escribió desde la última vez que se le habló (hasta 4 mensajes seguidos). */
export function textoPendiente(ctx: ContextoAgente): string {
  const ms = ctx.mensajes ?? [];
  const piezas: string[] = [];
  for (let i = ms.length - 1; i >= 0 && piezas.length < 4; i--) {
    const m = ms[i];
    if (m.direccion !== 'entrante') break;
    if (m.tipo === 'button' || m.tipo === 'interactive' || m.tipo === 'reaction' || m.tipo === 'sticker') continue;
    const t = (m.texto ?? '').trim();
    if (t) piezas.unshift(t);
  }
  if (!piezas.length) { const u = (ctx.ultimo_entrante?.texto ?? '').trim(); if (u) piezas.push(u); }
  return piezas.join('. ');
}

const esPrimeraRespuesta = (ctx: ContextoAgente): boolean => !(ctx.mensajes ?? []).some((m) => m.direccion === 'saliente' && m.tipo !== 'template');
const textosDichos = (ctx: ContextoAgente): Set<string> => {
  const s = new Set<string>();
  for (const m of ctx.mensajes ?? []) if (m.direccion === 'saliente' && m.texto) s.add(normalizar(m.texto));
  if (ctx.borrador_pendiente?.texto) s.add(normalizar(ctx.borrador_pendiente.texto));
  return s;
};

/** ¿Esta entrada puede ir en modo automático? Verificada por el propietario, o aprobada 3 veces sin cambios y sin que la corrija o descarte. */
export const puedeAuto = (e: EntradaBanco): boolean =>
  e.accion === 'responder' && e.activo && (e.verificada || (e.aprobados >= 3 && e.aprobados >= 2 * (e.editados + e.descartes)));

// Algunos negocios contestan como si Connexo fuera una tienda: piden mesa, hora, talla, stock, domicilio… Eso no es una pregunta
// sobre Connexo y no se responde con las respuestas de Connexo.
// Pistas FUERTES (productos y servicios de otro negocio): se aplican siempre, aunque la pregunta se parezca a una de Connexo
// («¿cuánto sale una consulta?» tiene la misma forma que «¿cuánto cuesta?»).
const RE_NEGOCIO_AJENO_FUERTE = /\b(talla|stock|modelo|a domicilio|domicilio|delivery|mi pedido|mi reserva|mi cita|mi orden|el pedido|el envio|mesa para|para \d+ (personas|pax|adultos|ninos)|(pedir|pedirte|encargar|comprar|ordenar|reservar|agendar) (una|un|unos|unas|dos|tres|mesa|cita|hora|turno)|(una|la|el|un|por) (consulta|sesion|corte|limpieza|matricula|pension|habitacion|noche|hora|kilo|libra|docena|plato|almuerzo|boda|evento|cabana|alquiler|arriendo|entrada|boleto|torta|pizza))\b/;
// Pistas DÉBILES (fechas y horas): solo cuentan si la coincidencia con Connexo no es perfecta («mañana te aviso» sí es de Connexo).
const RE_NEGOCIO_AJENO = /\b(hoy|manana|pasado manana|esta noche|esta tarde|este (sabado|domingo|lunes|martes|miercoles|jueves|viernes|fin de semana)|el (lunes|martes|miercoles|jueves|viernes|sabado|domingo)|a las \d{1,2}|\d{1,2} ?(am|pm))\b/;

export interface ResultadoRecuerdo {
  accion: AccionBanco;
  texto: string;
  intencion: string;
  confianza: 'alta' | 'media' | 'baja';
  nota: string;
  /** Entrada principal (para contar sus aciertos). */
  banco_id: string | null;
  puntaje: number;
  /** No se reconoció la pregunta (sirve para «mixto»: ahí sí se consulta al modelo). */
  sinCoincidencia: boolean;
  /** Las entradas que se usaron. */
  entradas: string[];
  /** Cumple lo necesario para ir sola en modo automático. */
  autoOk: boolean;
  variante?: OrigenBanco;
}

const pct = (x: number): string => `${Math.round(Math.min(1, x) * 100)} %`;
const recorte = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function responderConRecuerdo(ctx: ContextoAgente, banco: EntradaBanco[], aleatorio: () => number): ResultadoRecuerdo {
  const base = { texto: '', banco_id: null, puntaje: 0, sinCoincidencia: false, entradas: [] as string[], autoOk: false };
  const estado = ctx.envio?.estado ?? null;
  const cliente = textoPendiente(ctx);
  const vacio = banco.filter((b) => b.activo).length === 0;
  if (vacio) return { ...base, accion: 'traspasar', intencion: 'otro', confianza: 'baja', sinCoincidencia: true, nota: 'Todavía no hay respuestas en el banco del agente: respóndelo tú.' };

  const { candidatos, tokens, indice } = buscar(banco, cliente, estado);

  // Sin palabras con contenido: un saludo, signos de interrogación, un emoji…
  if (!tokens.length) {
    if (esSoloSaludo(cliente)) {
      // Las palabras de saludo no pesan al comparar: un saludo solo se atiende aquí, con la entrada que aplica a su etapa.
      const s = banco.find((b) => b.activo && b.intencion === 'saludo' && (!b.estados?.length || !estado || b.estados.includes(estado)));
      if (s) {
        if (s.accion === 'traspasar') return { ...base, accion: 'traspasar', intencion: s.intencion, confianza: 'alta', puntaje: 1, banco_id: s.id, entradas: [s.id], nota: s.nota || 'Te saludó: respóndele tú.' };
        return armar(ctx, [{ entrada: s, puntaje: 1, cobertura: 1, especificidad: 1, frase: 'saludo', cubiertos: [] }], 1, aleatorio, cliente);
      }
    }
    if (/\?/.test(cliente)) return { ...base, accion: 'traspasar', intencion: 'otro', confianza: 'baja', sinCoincidencia: true, nota: `Escribió «${recorte(cliente, 40)}»: parece confundido, míralo tú.` };
    // Con palabras pero todas de relleno («hay alguien ahí»): una persona escribió algo y no sé qué es. Solo lo trivial se calla.
    if (normalizar(cliente).length >= 6) return { ...base, accion: 'traspasar', intencion: 'otro', confianza: 'baja', sinCoincidencia: true, nota: `Escribió «${recorte(cliente, 60)}» y no sé qué quiere: respóndele tú.` };
    return { ...base, accion: 'omitir', intencion: 'otro', confianza: 'alta', nota: 'Mensaje sin contenido que responder.' };
  }

  let top = candidatos[0];
  // Callar ante algo que sí pedía respuesta es peor que contestar de más: si «solo agradece» apenas le gana a una pregunta real, gana la pregunta.
  if (top && top.entrada.accion === 'omitir') {
    const alt = candidatos.find((c) => c.entrada.accion !== 'omitir' && c.puntaje >= Math.max(AJUSTE.media, top.puntaje - 0.12));
    if (alt) top = alt;
  }
  // Un tema delicado (descuento, factura, queja…) que casi empata con una respuesta: gana el propietario. Pasarle un chat nunca hace daño.
  if (top && top.entrada.accion === 'responder') {
    // (solo si de verdad encaja: una coincidencia floja con un tema delicado no le quita la pregunta a una respuesta clara)
    const t = candidatos.find((c) => c.entrada.accion === 'traspasar' && c.cobertura >= 0.75 && c.puntaje >= Math.max(AJUSTE.media, top.puntaje - 0.1));
    if (t) top = t;
  }
  // El rival que importa es el de OTRO tema: dos respuestas del mismo tema (precio / pago mensual) no se estorban entre sí.
  const segundo = top ? candidatos.find((c) => c.entrada.id !== top.entrada.id && c.entrada.intencion !== top.entrada.intencion) : undefined;
  const ventaja = top ? top.puntaje - (segundo?.puntaje ?? 0) : 0;
  // Dos temas distintos casi empatados y ninguno claro: mejor no adivinar.
  const ambigua = !!top && top === candidatos[0] && top.entrada.accion === 'responder' && !!segundo && top.puntaje < AJUSTE.alta && ventaja < 0.04 && top.entrada.intencion !== segundo.entrada.intencion;
  const ajeno = !!top && (RE_NEGOCIO_AJENO_FUERTE.test(normalizar(cliente)) || (top.puntaje < 0.95 && RE_NEGOCIO_AJENO.test(normalizar(cliente))));
  if (ajeno) {
    return { ...base, accion: 'traspasar', intencion: 'otro', confianza: 'baja', sinCoincidencia: true, puntaje: top?.puntaje ?? 0,
      nota: 'Parece que te escribe como cliente de su negocio (pide algo con fecha, hora o producto), no una pregunta sobre Connexo: respóndele tú.' };
  }
  if (!top || top.puntaje < AJUSTE.media || ambigua) {
    const cerca = candidatos.slice(0, 2).filter((c) => c.puntaje >= 0.35);
    const pista = cerca.length ? ` Lo más parecido: ${cerca.map((c) => `«${c.entrada.titulo}» (${pct(c.puntaje)})`).join(', ')}.` : '';
    return {
      ...base, accion: 'traspasar', intencion: 'otro', confianza: 'baja', sinCoincidencia: true, puntaje: top?.puntaje ?? 0,
      nota: `${ambigua ? 'Dudo entre dos de mis respuestas.' : 'No reconocí esta pregunta en mis respuestas.'}${pista} Respóndela tú y la aprendo para la próxima.`,
    };
  }

  const e = top.entrada;

  if (e.accion === 'omitir') {
    return { ...base, accion: 'omitir', intencion: e.intencion, confianza: top.puntaje >= AJUSTE.alta ? 'alta' : 'media', puntaje: top.puntaje, banco_id: e.id, entradas: [e.id], nota: e.nota || `${e.titulo}: no hace falta responder.` };
  }
  if (e.accion === 'traspasar') {
    return {
      ...base, accion: 'traspasar', intencion: e.intencion, confianza: top.puntaje >= AJUSTE.alta ? 'alta' : 'media', puntaje: top.puntaje, banco_id: e.id, entradas: [e.id],
      nota: e.nota || `Tema que no respondo sola («${e.titulo}»): respóndelo tú.`,
    };
  }

  // ¿Preguntó dos cosas? Se busca una segunda respuesta con lo que la primera no explicó.
  const elegidos: Candidato[] = [top];
  const cubiertos = new Set(top.cubiertos);
  const resto = tokens.filter((t) => ![...cubiertos].some((c) => credito(t, c) > 0));
  const pesoDe = (t: string) => indice.idf.get(t) ?? indice.pesoDesconocido;
  const masaResto = resto.reduce((s, t) => s + pesoDe(t), 0);
  const masaTotal = tokens.reduce((s, t) => s + pesoDe(t), 0);
  if (resto.length && masaTotal > 0 && masaResto / masaTotal >= 0.3) {
    const sec = buscarTokens(indice, resto, estado).find((c) => c.entrada.id !== e.id && c.entrada.accion === 'responder' && c.puntaje >= AJUSTE.segunda);
    if (sec) elegidos.push(sec);
  }
  return armar(ctx, elegidos, ventaja, aleatorio, cliente);
}

function armar(ctx: ContextoAgente, elegidos: Candidato[], ventaja: number, aleatorio: () => number, cliente: string): ResultadoRecuerdo {
  const v = variablesDe(ctx);
  const evitar = textosDichos(ctx);
  const estado = ctx.envio?.estado ?? null;
  const top = elegidos[0];
  const partes: string[] = [];
  let origen: OrigenBanco | undefined;
  for (const c of elegidos) {
    const x = elegirVariante(c.entrada, v, evitar, aleatorio);
    if (!x) continue;
    if (!origen) origen = x.origen;
    partes.push(x.texto);
  }
  if (!partes.length) {
    return {
      accion: 'traspasar', texto: '', intencion: top.entrada.intencion, confianza: 'baja', puntaje: top.puntaje, banco_id: top.entrada.id, entradas: [top.entrada.id],
      sinCoincidencia: false, autoOk: false, nota: `Reconocí «${top.entrada.titulo}» pero no tengo cómo decirlo para este negocio: respóndelo tú.`,
    };
  }
  let cuerpo = partes.join(' ');
  if (partes.length === 2 && cuerpo.length > 420) cuerpo = partes[0];
  const dosUsadas = partes.length === 2 && cuerpo === partes.join(' ');

  // El cierre lleva al siguiente paso (salvo que la propia respuesta ya lo traiga).
  const quiereCierre = elegidos.some((c) => c.entrada.cierre);
  if (quiereCierre && !/enviar demo/.test(normalizar(cuerpo))) {
    const lista = CIERRES[grupoDeCierre(estado)];
    const cierre = lista[Math.floor(aleatorio() * lista.length) % lista.length];
    if (cuerpo.length + cierre.length + 1 <= 500) cuerpo = `${cuerpo} ${cierre}`;
  }

  // Si es el primer mensaje que se le responde y él saludó, se le devuelve el saludo.
  let texto = cuerpo;
  if (esPrimeraRespuesta(ctx) && top.entrada.intencion !== 'saludo') {
    const s = saludoEspejo(cliente);
    if (s && !/^(hola|buen)/i.test(cuerpo)) texto = `${s}. ${cuerpo}`;
  }

  const usadas = dosUsadas ? elegidos : [top];
  const alta = top.puntaje >= AJUSTE.alta && ventaja >= AJUSTE.ventaja;
  // Para ir sola, además: el mensaje debe quedar casi entero explicado por la respuesta (no una pregunta con más cosas sin entender).
  const autoOk = usadas.every((c) => puedeAuto(c.entrada)) && top.puntaje >= AJUSTE.auto && ventaja >= AJUSTE.ventajaAuto
    && top.cobertura >= 0.9 && top.especificidad >= 0.7 && elegidos.length === usadas.length;
  const titulos = usadas.map((c) => `«${c.entrada.titulo}»`).join(' y ');
  return {
    accion: 'responder', texto, intencion: top.entrada.intencion, confianza: alta ? 'alta' : 'media', puntaje: top.puntaje,
    banco_id: top.entrada.id, entradas: usadas.map((c) => c.entrada.id), sinCoincidencia: false, autoOk, variante: origen,
    nota: `Entendí ${titulos} (${pct(top.puntaje)}).${autoOk ? '' : ' Revísalo antes de enviar.'}`,
  };
}

// ── Aprender: lo que el propietario envía vuelve al banco ───────────────────

export interface PlanBanco {
  accion: 'ninguna' | 'agregar' | 'crear';
  banco_id?: string;
  disparador?: string;
  variante?: string;
  titulo?: string;
  intencion?: string;
  motivo?: string;
}

/** Lo último que escribió el cliente sin que se le contestara (de un contexto [{d, t}] ya guardado). */
export function clienteDeContexto(contexto: { d: 'cliente' | 'nosotros'; t: string }[]): string {
  const piezas: string[] = [];
  for (let i = contexto.length - 1; i >= 0 && piezas.length < 3; i--) {
    if (contexto[i].d !== 'cliente') break;
    const t = (contexto[i].t ?? '').trim();
    if (t && !/^\[.+\]$/.test(t) && !/enviar demo|ver mas tarde/.test(normalizar(t))) piezas.unshift(t);
  }
  return piezas.join('. ');
}

const RE_ACTO_DE_ENTREGA = /\b(te (lo |la )?(envio|mando|paso|acabo|dejo)|ya te (lo |la )?(envie|mande|pase|deje)|aqui (tiene|esta|te dejo|van)|adjunto|en un momento|ahorita te|ya mismo|credenciales|tus credenciales|sus credenciales)\b/;

/** Vuelve genérica la respuesta del propietario (su nombre y el del negocio pasan a ser marcas). null = no sirve para otros chats. */
export function generalizar(
  texto: string, perfil: string | null, negocio: string | null,
  revisar: (t: string) => { ok: true; texto: string } | { ok: false; motivo: string },
): string | null {
  const rev = revisar(texto);
  if (!rev.ok) return null;
  let t = rev.texto;
  if (t.length < 12 || t.length > 480) return null;
  if (/@|\d{5,}/.test(t)) return null;
  if (RE_ACTO_DE_ENTREGA.test(normalizar(t))) return null;
  const pila = nombreDePila(perfil);
  if (pila) t = t.replace(new RegExp(`\\b${pila}\\b`, 'g'), '{nombre}');
  const neg = nombreDeNegocio(negocio);
  if (neg && neg.length >= 4) t = t.split(neg).join('{negocio}');
  return t;
}

const titular = (s: string): string => { const t = recorte(s.replace(/\s+/g, ' ').trim(), 70); return t.charAt(0).toUpperCase() + t.slice(1); };

export function planearAprendizaje(a: {
  origen: 'aprobado' | 'editado' | 'directo';
  textoHumano: string;
  contexto: { d: 'cliente' | 'nosotros'; t: string }[];
  bancoIdBorrador: string | null;
  banco: EntradaBanco[];
  nombrePerfil: string | null;
  negocio: string | null;
  revisar: (t: string) => { ok: true; texto: string } | { ok: false; motivo: string };
  esBot: (t: string) => boolean;
}): PlanBanco {
  // Un borrador del banco enviado tal cual ya estaba en el banco (su entrada suma el acierto). Uno de Claude enviado tal cual SÍ es nuevo
  // para el banco: es una respuesta que el propietario dio por buena, y así el banco se va llenando aunque se use Claude.
  if (a.origen === 'aprobado' && a.bancoIdBorrador) return { accion: 'ninguna', motivo: 'ya estaba en el banco' };
  const cliente = clienteDeContexto(a.contexto);
  if (!cliente) return { accion: 'ninguna', motivo: 'no hay pregunta del cliente a la que asociarla' };
  if (a.esBot(cliente)) return { accion: 'ninguna', motivo: 'el mensaje del cliente era una respuesta automática' };
  const variante = generalizar(a.textoHumano, a.nombrePerfil, a.negocio, a.revisar);
  if (!variante) return { accion: 'ninguna', motivo: 'la respuesta es muy particular de ese chat para guardarla' };

  const { candidatos, tokens } = buscar(a.banco, cliente, null);
  const dePartida = a.bancoIdBorrador ? a.banco.find((b) => b.id === a.bancoIdBorrador) : undefined;
  const mejor = candidatos[0];
  const destino = dePartida && dePartida.accion === 'responder'
    ? dePartida
    : mejor && mejor.puntaje >= 0.75 && mejor.entrada.accion === 'responder' ? mejor.entrada : undefined;   // ante la duda, entrada nueva: mejor que meter la respuesta en el tema equivocado

  if (destino) {
    const cubre = candidatos.find((c) => c.entrada.id === destino.id)?.puntaje ?? 0;
    return { accion: 'agregar', banco_id: destino.id, variante, disparador: cubre >= 0.9 ? undefined : recorte(cliente, 160) };
  }
  if (tokens.length < 2) return { accion: 'ninguna', motivo: 'la pregunta es muy corta para crear una respuesta nueva' };
  return { accion: 'crear', titulo: titular(cliente), intencion: 'aprendida', disparador: recorte(cliente, 160), variante };
}
