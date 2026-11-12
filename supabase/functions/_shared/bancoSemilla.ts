// Respuestas DE FÁBRICA del banco del agente (motor «recuerdo», migración 0018).
//
// Cada entrada es una pregunta frecuente (o un tema delicado que se le deja al propietario) con:
//   · disparadores: cómo la preguntan los negocios (se escriben como se hablan, sin tildes ni signos: da igual)
//   · respuestas: varias formas de decirlo, para no sonar a máquina (el agente rota y no repite lo ya dicho en el chat)
//   · estados: en qué etapa de la demo aplica (null = siempre)
//   · cierre: si se le agrega al final el paso siguiente (tocar el botón, entrar a su perfil…)
//
// Los HECHOS salen únicamente de conocimientoConnexo.ts (precios, prueba de 7 días, plantillas…) y de lo que el propietario ya
// les ha respondido a los negocios. Todas se escriben sin emojis, cortas y en español de Ecuador. Un test (test-recuerdo) pasa
// cada variante por `revisarRespuesta`: si alguien edita un precio aquí y no existe en conocimientoConnexo.ts, el test falla.
//
// Cómo se siembran: la acción `agente_banco_sembrar` de koda-connexo las sube a la tabla `wa_agente_banco` por `clave` (idempotente;
// lo que el propietario editó o aprendió no se pisa). Marcas disponibles en las respuestas: {nombre} {negocio} {beneficio}
// {direccion} {enlace}. Una frase con una marca sin valor se omite sola.

export interface Semilla {
  clave: string;
  titulo: string;
  intencion: string;
  accion: 'responder' | 'traspasar' | 'omitir';
  disparadores: string[];
  excluye?: string[];
  respuestas?: string[];
  estados?: string[];
  cierre?: boolean;
  nota?: string;
}

/** Etapas de la demo (estado del envío en Connexo). */
const SIN_ACEPTAR = ['borrador', 'aprobado', 'wa_enviado'];
const ACEPTADO = ['aceptado'];
const PAUSADO = ['declinado', 'vencido'];

export const SEMILLAS: Semilla[] = [
  // ── Lo que más preguntan ──────────────────────────────────────────────────
  {
    clave: 'precio', titulo: 'Cuánto cuesta', intencion: 'precio', accion: 'responder', cierre: true, excluye: ['descuento', 'caro', 'factura'],
    disparadores: [
      'cuanto cuesta', 'cuanto vale', 'cuanto cobran', 'cuanto tengo que pagar', 'cuanto es', 'cuanto me costaria', 'que precio tiene', 'que valor tiene',
      'cual es el precio', 'cuales son los precios', 'cuales son sus valores', 'cual es el valor', 'que costo tiene', 'precio', 'precios', 'valor', 'valores',
      'costo', 'costos', 'tarifa', 'tarifas', 'planes y precios', 'me pasas los precios', 'que planes tienen', 'cuales son los planes',
      'cuanto cuesta el plan', 'cuanto cuesta el servicio', 'y cuales son sus valores', 'precio del plan',
    ],
    respuestas: [
      'Probarlo no cuesta nada: son 7 días gratis con todo incluido y sin tarjeta. Si después decides quedarte, el plan PRO es de 9 dólares al mes (o 97 al año) y el ULTRA de 17 al mes (o 179 al año).',
      'Hay dos planes. El PRO sale 9 dólares al mes o 97 al año, y el ULTRA 17 al mes o 179 al año. Antes de decidir lo pruebas 7 días gratis y sin tarjeta.',
      'El PRO cuesta 9 dólares al mes (97 si pagas el año) y el ULTRA 17 al mes (179 el año). Primero lo pruebas 7 días gratis con todo, sin tarjeta, y si no sigues no pagas nada.',
      'Los planes son PRO a 9 dólares al mes o 97 al año, y ULTRA a 17 al mes o 179 al año. Cualquiera incluye tu tarjeta NFC personalizada o una pulsera NFC, y antes lo pruebas 7 días gratis.',
    ],
  },
  {
    clave: 'pago_mensual', titulo: 'Si se paga todos los meses', intencion: 'precio', accion: 'responder', cierre: true,
    disparadores: [
      'se paga todos los meses', 'se paga cada mes', 'es mensual', 'pago mensual', 'hay que pagar cada mes', 'cobran mensualidad', 'es un solo pago', 'es pago unico',
      'se paga una sola vez', 'es por suscripcion', 'es una suscripcion', 'tengo que pagar siempre', 'es mensual o anual', 'anual o mensual', 'como se paga',
      'se paga eternamente', 'cada cuanto se paga', 'pago por mes', 'pago por ano', 'es de por vida', 'hay que renovar',
    ],
    respuestas: [
      'Solo si decides quedarte después de la prueba. Puedes pagar mes a mes o, si prefieres, un solo pago al año que te sale más barato. Si no sigues, no pagas nada.',
      'Es una suscripción: mensual o anual, tú eliges. El año sale más barato que pagar los 12 meses, y si al terminar la prueba no sigues, no se cobra nada.',
      'No es obligatorio: la prueba de 7 días no cuesta. Después, si te sirve, pagas cada mes o un solo pago anual con ahorro.',
    ],
  },
  {
    clave: 'pagina_web', titulo: 'Si es una página web', intencion: 'pagina_web', accion: 'responder', cierre: true, excluye: ['yatengo'],
    disparadores: [
      'es una pagina web', 'esto es una pagina web', 'es una web', 'es un sitio web', 'es como una pagina web', 'hacen paginas web', 'venden paginas web', 'necesito una pagina web',
      'quiero una pagina web', 'pagina web', 'es una pagina', 'sitio web', 'es un website', 'son paginas web', 'es lo mismo que una pagina web', 'tienen paginas web', 'no es solo una pagina web', 'es algo mas que una web', 'es mas que una pagina web',
    ],
    respuestas: [
      'Es un perfil propio que hace lo que normalmente se le pide a una página web, pero más directo: catálogo, pedidos o citas, contacto por WhatsApp, redes y ubicación en un solo enlace. No pagas hosting ni programas nada, y lo editas desde el celular.',
      'Se parece, pero es más práctico: un solo enlace con tu catálogo, tus redes, tu ubicación y, según tu rubro, pedidos o reservas. Lo editas tú desde el celular y se ve al instante.',
      'Más que una página web: es el perfil de tu negocio con su propia dirección, donde tus clientes te escriben, ven lo que vendes y {beneficio}. Sin hosting y sin programar.',
    ],
  },
  {
    clave: 'ya_tengo_web', titulo: 'Ya tiene página web', intencion: 'pagina_web', accion: 'responder', cierre: true,
    disparadores: ['ya tengo pagina web', 'ya tengo web', 'ya tengo sitio web', 'ya tenemos pagina web', 'ya tengo mi pagina', 'tengo pagina web', 'ya cuento con pagina web', 'ya tengo mi web', 'tengo un sitio hecho en wordpress', 'mi pagina esta en wix', 'tengo una web en wordpress'],
    respuestas: [
      'Perfecto, se complementan: tu página queda como está y este perfil es el enlace corto que pones en tus redes y en WhatsApp para que te contacten, pidan o reserven más directo.',
      'No compite con tu página: el perfil es el enlace para tu biografía de Instagram, tu WhatsApp y tu código QR, y puede mandar a tus clientes a tu página si quieres.',
    ],
  },
  {
    clave: 'sin_web', titulo: 'No tiene página ni redes', intencion: 'pagina_web', accion: 'responder', cierre: true,
    disparadores: ['no tengo pagina web', 'no tengo web', 'no tengo sitio web', 'no tengo nada digital', 'no tengo redes', 'no tengo instagram', 'no uso redes', 'no tengo pagina', 'mi negocio no tiene instagram', 'no tenemos redes', 'no tenemos pagina web'],
    respuestas: [
      'Justo para eso sirve: en un solo enlace tienes tu presencia completa, con tus datos, fotos y contacto, sin necesitar página web ni manejar muchas redes. Ya te lo armamos con la información de tu negocio.',
      'Perfecto, así partes de cero y bien armado: tu perfil reúne en un enlace lo que tus clientes buscan, y lo editas tú desde el celular.',
    ],
  },
  {
    clave: 'redes', titulo: 'Si sirve para todas las redes', intencion: 'redes', accion: 'responder', cierre: true,
    disparadores: [
      'es para todas las redes sociales', 'sirve para todas las redes', 'funciona en instagram', 'funciona con facebook', 'lo puedo poner en instagram', 'lo puedo poner en tiktok',
      'sirve para instagram', 'se puede poner en la biografia', 'en mis redes', 'para redes sociales', 'con mis redes', 'redes', 'link para instagram', 'sirve para facebook',
      'funciona para tiktok', 'puedo compartirlo en whatsapp', 'instagram', 'facebook', 'tiktok', 'puedo enlazar mi tiktok', 'puedo enlazar mi instagram',
    ],
    respuestas: [
      'Sí. Es un solo enlace que pones en la biografía de Instagram, Facebook y TikTok, en tu WhatsApp o en un código QR impreso, y desde ahí tus clientes lo tienen todo.',
      'Sí, funciona con todas: pones el mismo enlace en la biografía de Instagram, Facebook y TikTok y en tu WhatsApp, y también sale en un código QR para imprimir.',
    ],
  },
  {
    clave: 'como_funciona', titulo: 'Cómo funciona / qué es', intencion: 'como_funciona', accion: 'responder', cierre: true,
    disparadores: [
      'como funciona', 'de que se trata', 'que es esto', 'que es connexo', 'en que consiste', 'explicame', 'me puedes explicar', 'no entiendo', 'no comprendo', 'estoy perdida',
      'estoy perdido', 'estoy un poco perdida', 'no me quedo claro', 'mas informacion', 'quiero mas informacion', 'informacion', 'que ofrecen', 'que es esto exactamente',
      'para que sirve', 'de que trata', 'explicame mejor', 'no se de que se trata', 'que es eso', 'no se que es', 'que hacen ustedes', 'a que se dedican', 'en pocas palabras que hacen', 'que es lo que hacen', 'recibi un mensaje de ustedes', 'me llego un mensaje de ustedes', 'que es este mensaje', 'de que se trata esto',
    ],
    respuestas: [
      'Te armamos gratis un perfil digital de tu negocio con tus datos reales, con su propia dirección. Ahí tus clientes ven lo que ofreces, te escriben por WhatsApp y, según tu rubro, piden o reservan. Lo pruebas 7 días sin tarjeta.',
      'Es un perfil profesional para tu negocio: un solo enlace con tus fotos, servicios, redes y contacto, y según tu rubro con pedidos o reservas. Ya te lo armamos con tus datos para que lo veas funcionando antes de decidir.',
      'Connexo arma el perfil digital de tu negocio: un solo enlace donde tus clientes te encuentran y te escriben. En el tercer botón del primer mensaje tienes nuestra web con todo explicado, y la demo con tus datos es gratis 7 días.',
    ],
  },
  {
    clave: 'que_incluye', titulo: 'Qué incluye / para qué sirve', intencion: 'como_funciona', accion: 'responder', cierre: true,
    disparadores: [
      'que incluye', 'que incluyen los planes', 'que me ofrecen', 'que servicios ofrecen ustedes', 'que puedo hacer con esto', 'que ventajas tiene', 'que funciones tiene', 'que trae',
      'que beneficios tiene', 'para que me sirve', 'que gano', 'como me beneficia', 'como me sirve', 'que otras funciones tiene', 'que trae el plan', 'que incluye cada plan',
    ],
    respuestas: [
      'Tu perfil público con foto, portada, contacto, ubicación, redes y enlaces ilimitados, el código QR y las analíticas de visitas. Y por tu rubro, tus clientes {beneficio}.',
      'Todo en un enlace: tus datos de contacto, fotos, redes, ubicación y horarios, con código QR y estadísticas de visitas. Además, tus clientes {beneficio}.',
    ],
  },
  {
    clave: 'funciones_rubro', titulo: 'Reservas, pedidos o catálogo (según su rubro)', intencion: 'como_funciona', accion: 'responder', cierre: true,
    disparadores: [
      'se pueden hacer reservas', 'agenda citas', 'puedo recibir pedidos', 'recibe pedidos', 'puedo vender por ahi', 'tiene carrito', 'tiene catalogo', 'puedo subir mis productos',
      'puedo poner mis servicios', 'tiene reservas', 'tiene citas', 'toma pedidos', 'sirve para vender', 'puedo vender', 'catalogo de productos', 'sirve para agendar',
      'puedo tomar pedidos', 'pueden reservar', 'se puede pedir por ahi', 'mis clientes pueden hacer pedidos', 'pueden pedir desde el perfil', 'mis clientes pueden reservar',
    ],
    respuestas: [
      'Sí, depende de tu rubro y ya viene armado: tus clientes {beneficio}.',
      'Sí. En tu caso, tus clientes {beneficio}. Todo lo editas tú desde el celular.',
    ],
  },
  {
    clave: 'prueba_gratis', titulo: 'Es gratis / cómo es la prueba', intencion: 'prueba', accion: 'responder', cierre: true,
    disparadores: [
      'es gratis', 'de verdad es gratis', 'es gratuito', 'cuanto dura la prueba', 'cuantos dias es la prueba', 'la prueba es gratis', 'hay que pagar algo', 'necesito tarjeta',
      'piden tarjeta', 'me van a cobrar', 'me cobran algo', 'cual es el truco', 'sin costo', 'no cobran nada', 'tiene algun costo la prueba', 'cuanto tiempo es gratis', 'hay que pagar para probarlo', 'tengo que pagar para probar', 'se paga para probarlo', 'cobran por la prueba', 'piden tarjeta para empezar', 'necesito dar mi tarjeta', 'cuanto dura la demo', 'cuantos dias dura la demo', 'cuanto tiempo dura la demo', 'cuanto dura la demostracion',
    ],
    respuestas: [
      'Sí, la prueba es gratis: 7 días con todas las funciones del plan ULTRA, sin tarjeta ni pago. Si no sigues, el perfil se suspende y no se cobra nada.',
      'Gratis por 7 días y sin tarjeta. Tienes todo el plan ULTRA para probarlo con tus datos, y si no te sirve no pagas nada.',
    ],
  },
  {
    clave: 'al_terminar_prueba', titulo: 'Qué pasa al terminar la prueba', intencion: 'prueba', accion: 'responder', cierre: true,
    disparadores: [
      'que pasa despues de los 7 dias', 'que pasa cuando termina la prueba', 'y si no me sirve', 'y despues que', 'al terminar la prueba', 'me cobran automatico', 'se renueva solo',
      'se cobra automaticamente', 'y si no pago', 'que pasa si no pago', 'pierdo mis datos', 'que pasa si no sigo', 'y si no quiero seguir', 'despues de la prueba que', 'que pasa si no me gusta', 'y si no me gusta', 'si no me gusta',
    ],
    respuestas: [
      'Al terminar los 7 días el perfil se suspende y no se cobra nada. Tus datos se guardan 30 días por si decides retomarlo.',
      'No se renueva ni se cobra solo. Si no sigues con un plan, el perfil se pausa y tus datos quedan guardados 30 días.',
    ],
  },
  {
    clave: 'dominio', titulo: 'Dominio propio', intencion: 'otro', accion: 'responder', cierre: true,
    disparadores: ['puedo tener mi propio dominio', 'dominio propio', 'mi dominio', 'tunegocio.com', 'puedo usar mi dominio', 'dominio personalizado', 'url propia', 'quiero que sea .com.ec', 'quiero un .com', 'quiero mi propio dominio', 'con mi dominio', 'pagina con mi nombre'],
    respuestas: [
      'No: la dirección de tu perfil es connexoapp.com seguido del nombre de tu negocio, por ejemplo connexoapp.com/tu-negocio. Es corta y fácil de compartir, pero no se puede usar un dominio propio.',
      'Por ahora no se usa dominio propio: tu dirección queda como connexoapp.com/ y el nombre de tu negocio, y esa misma te sirve para tus redes y tu código QR.',
    ],
  },
  {
    clave: 'direccion', titulo: 'Cómo sería su dirección', intencion: 'otro', accion: 'responder', cierre: true,
    disparadores: [
      'le pones una direccion personalizada o es generica', 'como seria mi direccion', 'cual seria mi enlace', 'cual es mi link', 'como queda mi direccion', 'que direccion tendria',
      'el enlace es personalizado', 'mi propio enlace', 'link personalizado', 'direccion personalizada', 'direccion generica', 'como se llamaria mi enlace', 'con que nombre queda',
    ],
    respuestas: [
      'Es personalizada, con el nombre de tu negocio. En tu caso quedaría {direccion}.',
      'Personalizada con tu nombre: connexoapp.com/ y el nombre de tu negocio. {direccion} sería la tuya, y esa misma te sirve para tu código QR.',
      'Queda con el nombre de tu negocio, por ejemplo connexoapp.com/nombre-de-tu-negocio. Es corta y la compartes en tus redes y en un código QR.',
    ],
  },
  {
    clave: 'editar', titulo: 'Si puede cambiar fotos y textos', intencion: 'como_funciona', accion: 'responder', cierre: true,
    disparadores: [
      'puedo cambiar las fotos', 'puedo cambiar los textos', 'yo lo puedo editar', 'como lo edito', 'quien lo actualiza', 'puedo modificarlo', 'puedo cambiar los precios',
      'lo puedo actualizar yo', 'se puede editar', 'puedo cambiar los colores', 'como cambio mis datos', 'puedo cambiar el diseno', 'puedo agregar mas productos', 'puedo subir fotos', 'puedo poner mi logo', 'puedo subir mi logo', 'puedo cambiar el logo', 'puedo poner el logo de mi empresa',
    ],
    respuestas: [
      'Sí, todo lo editas tú: fotos, portada, logo, colores, catálogo, horarios y enlaces, desde el celular o la computadora, y el cambio se ve al instante.',
      'Claro, es tuyo: cambias fotos, textos, colores, catálogo y horarios cuando quieras, sin pedirle nada a nadie, y se actualiza al momento.',
    ],
  },
  {
    clave: 'quien_arma', titulo: 'Quién lo arma / cuánto tarda', intencion: 'como_funciona', accion: 'responder', cierre: true,
    disparadores: [
      'quien lo arma', 'quien lo hace', 'tengo que hacerlo yo', 'cuanto demora', 'cuanto tarda', 'cuando estaria listo', 'en cuanto tiempo', 'cuanto toma empezar', 'que tengo que hacer',
      'tengo que subir todo yo', 'lo arman ustedes', 'quien me va a hacer el perfil', 'quien me lo hace', 'quien lo va a hacer', 'tengo que llenar todo', 'yo tengo que llenar todo', 'debo llenar mis datos', 'ya esta armado',
    ],
    respuestas: [
      'Ya lo armamos nosotros con los datos públicos de tu negocio, así que no tienes que hacer nada para verlo. Al aceptar la demo te llega tu enlace al instante y después lo ajustas a tu gusto.',
      'La demo ya está armada con tus datos reales y con fotos y textos de ejemplo de tu rubro. Cuando la activas, tú la editas como quieras y el cambio se ve en el momento.',
    ],
  },
  {
    clave: 'app_celular', titulo: 'Si hay que descargar una app', intencion: 'como_funciona', accion: 'responder', cierre: true,
    disparadores: ['hay app', 'se descarga', 'funciona en celular', 'tengo que instalar algo', 'necesito descargar una app', 'se instala', 'funciona en el telefono', 'es una aplicacion', 'funciona en computadora', 'hay que bajar algo', 'se puede usar desde el celular', 'puedo usarlo en el celular', 'lo uso desde el celular', 'lo abro desde la computadora', 'funciona en la computadora', 'se abre desde la compu'],
    respuestas: [
      'No necesitas descargar nada: funciona en el navegador de cualquier celular o computadora, y si quieres lo instalas como app sin pasar por ninguna tienda.',
      'Se abre desde el navegador, en celular o computadora, sin instalar nada. Si te gusta tenerlo como app, se agrega a la pantalla de inicio con un toque.',
    ],
  },
  {
    clave: 'inteligencia_artificial', titulo: 'Si usa inteligencia artificial', intencion: 'otro', accion: 'responder', cierre: true,
    disparadores: ['tiene inteligencia artificial', 'usa ia', 'tiene ia', 'es con ia', 'chatgpt', 'tiene un asistente', 'lleva inteligencia artificial'],
    respuestas: [
      'Connexo no usa inteligencia artificial: es un perfil que tú editas y que se ve al instante, con las funciones que tu rubro necesita.',
    ],
  },
  {
    clave: 'cobrar_clientes', titulo: 'Cómo cobra a sus clientes', intencion: 'otro', accion: 'responder', cierre: true,
    disparadores: [
      'puedo cobrar por ahi', 'acepta tarjeta', 'payphone', 'transferencia', 'como cobro a mis clientes', 'formas de pago', 'pasarela de pago', 'pagos en linea', 'puedo recibir pagos',
      'mis clientes pueden pagar por ahi', 'puedo cobrar con tarjeta',
    ],
    respuestas: [
      'Sí, según tu rubro tus clientes pueden pagarte con link de pago, PayPhone, transferencia bancaria o por WhatsApp, con el detalle y el monto ya escritos. Tú activas las que uses.',
    ],
  },
  {
    clave: 'whatsapp_integrado', titulo: 'WhatsApp y pedidos', intencion: 'otro', accion: 'responder', cierre: true,
    disparadores: ['me llegan los pedidos al whatsapp', 'se conecta con whatsapp', 'boton de whatsapp', 'me escriben por whatsapp', 'tiene whatsapp', 'se integra con whatsapp', 'como me contactan'],
    respuestas: [
      'Sí, tu perfil tiene botón de WhatsApp para que te escriban directo y, en pedidos y reservas, el chat se abre con el detalle y el monto ya escritos.',
    ],
  },
  {
    clave: 'qr_nfc', titulo: 'Código QR y tarjeta NFC', intencion: 'otro', accion: 'responder', cierre: true,
    disparadores: [
      'tiene codigo qr', 'puedo imprimir el qr', 'tiene tarjeta nfc', 'que es nfc', 'incluye tarjeta', 'viene con tarjeta fisica', 'pulsera nfc', 'tarjeta de presentacion',
      'tarjeta fisica', 'incluye pulsera', 'codigo qr', 'qr', 'el qr', 'nfc',
    ],
    respuestas: [
      'Sí: tu perfil tiene su código QR para imprimir, y cualquiera de los planes incluye una tarjeta NFC personalizada o una pulsera para compartirlo con un toque.',
    ],
  },
  {
    clave: 'analiticas', titulo: 'Estadísticas de visitas', intencion: 'otro', accion: 'responder', cierre: true,
    disparadores: ['puedo ver cuantas visitas', 'estadisticas', 'analiticas', 'cuanta gente entra', 'puedo medir', 'reportes', 'sabre cuantos entran', 'tiene metricas', 'cuantas personas entran a mi perfil', 'cuantos entran a mi perfil', 'puedo ver quien entra a mi perfil', 'cuanta gente visita mi perfil', 'cuantas visitas tiene mi perfil', 'quien visita mi perfil'],
    respuestas: [
      'Sí, ves las visitas a tu perfil, los clics en cada botón y cuántos se convierten en contactos, pedidos o reservas.',
    ],
  },
  {
    clave: 'ya_tengo_algo', titulo: 'Ya usa otra herramienta', intencion: 'objecion', accion: 'responder', cierre: true,
    disparadores: ['ya uso linktree', 'tengo linktree', 'ya tengo un linktree', 'ya tengo carta digital', 'ya tengo un catalogo en whatsapp', 'ya tengo algo parecido', 'ya tengo un sistema', 'ya uso otra plataforma', 'ya tengo quien me lo haga', 'ya tengo community manager'],
    respuestas: [
      'Puede convivir con lo que ya usas. Un Linktree junta enlaces; este perfil además muestra tu catálogo, recibe pedidos o reservas según tu rubro y lleva el club de clientes. Lo pruebas 7 días gratis y comparas.',
    ],
  },
  {
    clave: 'tamano_negocio', titulo: 'Si sirve para su tipo de negocio', intencion: 'como_funciona', accion: 'responder', cierre: true,
    disparadores: ['soy pequeno', 'mi negocio es pequeno', 'es para negocios grandes', 'sirve para emprendedores', 'soy emprendedor', 'soy independiente', 'trabajo solo', 'para que tipo de negocio sirve', 'sirve para mi negocio', 'sirve para mi rubro'],
    respuestas: [
      'Sirve para negocios de todos los tamaños: cada uno tiene su propio perfil, con lo que su rubro necesita. En tu caso, tus clientes {beneficio}.',
    ],
  },
  {
    clave: 'objecion_caro', titulo: 'Le parece caro', intencion: 'objecion', accion: 'responder', cierre: false, excluye: ['descuento'],
    disparadores: ['es muy caro', 'esta caro', 'es costoso', 'no tengo presupuesto', 'no tengo plata', 'no me alcanza', 'no me alcanza la plata', 'esta carisimo', 'muy caro para mi', 'es mucho dinero', 'es mucha plata'],
    respuestas: [
      'Te entiendo. Por eso lo pruebas 7 días gratis y sin tarjeta: ves tu perfil armado con tus datos y solo pagas si te sirve. El plan PRO parte desde 9 dólares al mes.',
      'Lo entiendo. Antes de gastar algo lo ves funcionando con tus datos, gratis por 7 días y sin dar tarjeta. Si no te convence, no pagas nada.',
    ],
  },
  {
    clave: 'confianza', titulo: 'Desconfía o pregunta si es seguro', intencion: 'objecion', accion: 'responder', cierre: false,
    disparadores: ['es seguro', 'es confiable', 'es de confianza', 'es verdad', 'como se que es real', 'no es estafa', 'tienen respaldo', 'donde puedo ver mas', 'es de verdad'],
    excluye: ['molesto'],
    respuestas: [
      'Entiendo la duda. Por eso la demo es gratis y sin tarjeta: ves tu perfil armado con tus datos y no pagas nada si no sigues. Si quieres conocer más de Connexo, entra a web.connexoapp.com.',
      'Es normal preguntarlo. No te pedimos tarjeta ni pago para probar, y puedes ver todo lo que hacemos en web.connexoapp.com antes de decidir.',
    ],
  },
  {
    clave: 'quien_eres', titulo: 'Quién escribe y por qué', intencion: 'otro', accion: 'responder', cierre: true,
    disparadores: ['quien eres', 'quien me escribe', 'de donde me escriben', 'de parte de quien', 'quien es connexo', 'de que empresa', 'que empresa es', 'como se llama la empresa', 'quien habla', 'quienes son', 'quien es usted'],
    respuestas: [
      'Soy del equipo de Connexo, una plataforma de perfiles digitales para negocios de Ecuador. Te escribimos porque vimos tu negocio en Google y te armamos una demo gratis de tu perfil.',
    ],
  },

  // ── Interés, saludo y despedidas ──────────────────────────────────────────
  {
    clave: 'interes', titulo: 'Quiere probarlo (aún sin activar)', intencion: 'interes', accion: 'responder', cierre: false, estados: SIN_ACEPTAR,
    disparadores: [
      'si me interesa', 'me interesa', 'si me gustaria', 'me gustaria', 'quiero probarlo', 'quiero probar', 'quiero la demo', 'dale', 'adelante', 'empecemos',
      'quiero empezar', 'activalo', 'como lo activo', 'como empiezo', 'si', 'si quiero', 'si por favor', 'si enviame la demo', 'estoy interesada', 'estoy interesado',
      'si claro', 'enviame la demo', 'mandame la demo', 'activame la demo', 'como hago para probarlo', 'como lo pruebo', 'dame el acceso', 'dame el acceso a la demo', 'quiero el acceso a la demo', 'dame acceso a mi perfil',
    ],
    respuestas: [
      'Perfecto. Toca el botón «¡Sí, enviar demo!» del primer mensaje que te envié y en segundos te llega tu enlace y tu clave para entrar. Si no ves el botón, avísame.',
      'Genial. Para activarlo toca «¡Sí, enviar demo!» en el primer mensaje que te mandé y al instante te llega tu perfil con tus datos y tu clave. Si no te aparece, dime.',
    ],
  },
  {
    clave: 'interes_aceptado', titulo: 'Interés cuando ya tiene la demo', intencion: 'interes', accion: 'responder', cierre: false, estados: ACEPTADO,
    disparadores: ['si me interesa', 'me interesa', 'si me gustaria', 'me gustaria', 'quiero seguir', 'quiero contratar', 'como contrato', 'me quedo con el plan', 'como sigo', 'quiero el plan', 'quiero el pro', 'quiero el ultra', 'como pago', 'quiero pagar'],
    respuestas: [
      'Me alegra. Para pasar a un plan lo coordinamos por aquí: dime si prefieres PRO (9 dólares al mes o 97 al año) o ULTRA (17 al mes o 179 al año) y lo dejamos listo.',
    ],
  },
  {
    clave: 'interes_pausado', titulo: 'Interés tras decir «más tarde» o vencer', intencion: 'interes', accion: 'traspasar', estados: PAUSADO,
    disparadores: ['si me interesa', 'me interesa', 'si me gustaria', 'me gustaria', 'quiero probarlo', 'quiero la demo', 'dale', 'adelante', 'empecemos', 'como lo activo', 'si', 'si quiero', 'si por favor', 'enviame la demo', 'estoy interesada', 'estoy interesado'],
    nota: 'Antes dijo «Ver más tarde» o su invitación venció, y ahora muestra interés: tienes que reactivarle la demo tú.',
  },
  {
    clave: 'ejemplo_demo', titulo: 'Quiere ver cómo se ve (aún sin activar)', intencion: 'interes', accion: 'responder', cierre: false, estados: SIN_ACEPTAR,
    disparadores: [
      'puedo ver un ejemplo', 'muestrame un ejemplo', 'tienes un ejemplo', 'como se ve', 'como quedaria mi perfil', 'quiero ver mi perfil', 'puedo ver la demo', 'mandame el enlace', 'envien la demo',
      'pasame el link', 'mandame el link', 'donde lo veo', 'tienen ejemplos', 'puedo ver como queda', 'ver demo', 'ver ejemplo', 'ver como se ve', 'pasame el enlace', 'pasame el enlace para verlo', 'enviame el enlace para verlo',
    ],
    respuestas: [
      'Te lo muestro con tus propios datos: toca «¡Sí, enviar demo!» en el primer mensaje que te envié y al instante te llega tu enlace para verlo y probarlo 7 días.',
      'Para que lo veas con tu información, toca «¡Sí, enviar demo!» en el primer mensaje. Se activa tu perfil y te llega el enlace con la clave al momento.',
    ],
  },
  {
    clave: 'ejemplo_demo_aceptado', titulo: 'Quiere ver su perfil (ya activo)', intencion: 'interes', accion: 'responder', cierre: true, estados: ACEPTADO,
    disparadores: [
      'puedo ver un ejemplo', 'como se ve', 'como quedaria mi perfil', 'quiero ver mi perfil', 'puedo ver la demo', 'mandame el enlace', 'pasame el link', 'mandame el link', 'donde lo veo',
      'no encuentro mi perfil', 'donde esta mi perfil', 'ver demo', 'ver como se ve', 'cual es mi enlace',
    ],
    respuestas: [
      'Ya lo tienes activo: entra a {enlace} y lo ves tal como lo verán tus clientes.',
      'Tu perfil ya está activo en {enlace}. Entra con tu correo y la clave temporal que te llegó para editarlo.',
      'Ya lo tienes listo: el enlace y tu clave temporal te llegaron por este mismo chat cuando aceptaste la demo.',
    ],
  },
  {
    clave: 'ejemplo_demo_pausado', titulo: 'Quiere ver el perfil tras «más tarde» o vencer', intencion: 'interes', accion: 'traspasar', estados: PAUSADO,
    disparadores: ['puedo ver un ejemplo', 'como se ve', 'quiero ver mi perfil', 'puedo ver la demo', 'mandame el enlace', 'mandame el link', 'donde lo veo', 'ver demo', 'quiero verlo'],
    nota: 'Antes dijo «Ver más tarde» o su invitación venció y ahora pide ver la demo: reactívasela tú.',
  },
  {
    clave: 'ayuda_uso', titulo: 'Ayuda para usar su perfil (ya activo)', intencion: 'soporte', accion: 'responder', cierre: true, estados: ACEPTADO,
    disparadores: ['como cambio la foto', 'donde edito', 'como entro', 'como edito', 'como configuro', 'no se como usarlo', 'ayudame a configurar', 'tutorial', 'manual', 'como lo uso', 'por donde empiezo', 'como subo mis productos', 'como cambio los precios'],
    respuestas: [
      'Entra con tu correo y la clave que te llegó y en el panel editas todo: foto, portada, catálogo, horarios y enlaces. Si te quedas pegado en algo, dime en cuál y te guío.',
    ],
  },
  {
    clave: 'saludo', titulo: 'Solo saluda', intencion: 'saludo', accion: 'responder', cierre: false, estados: SIN_ACEPTAR,
    disparadores: ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'hola buenas tardes', 'buen dia', 'saludos', 'hola que tal', 'hola como estas'],
    respuestas: [
      'Hola, qué gusto. Te escribí para mostrarte cómo quedaría tu negocio con un perfil digital propio. Si quieres verlo con tus datos, toca «¡Sí, enviar demo!» en el primer mensaje.',
      'Hola, bienvenido. Te armamos gratis una demo de tu perfil digital con los datos de tu negocio; si quieres verla, toca «¡Sí, enviar demo!» en el primer mensaje.',
    ],
  },
  {
    clave: 'saludo_aceptado', titulo: 'Solo saluda (ya activo)', intencion: 'saludo', accion: 'responder', cierre: false, estados: ACEPTADO,
    disparadores: ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'hola buenas tardes', 'buen dia', 'saludos'],
    respuestas: [
      'Hola, ¿cómo vas con tu perfil? Si necesitas ayuda con algún ajuste, dime.',
      'Hola, qué gusto. Cuéntame cómo te fue con tu perfil y qué quieres ajustar.',
    ],
  },
  {
    clave: 'saludo_pausado', titulo: 'Solo saluda (dijo «más tarde» o venció)', intencion: 'saludo', accion: 'traspasar', estados: PAUSADO,
    disparadores: ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'hola buenas tardes', 'buen dia', 'saludos'],
    nota: 'Te saludó después de decir «Ver más tarde» o de vencer su invitación: retoma tú la conversación.',
  },
  {
    clave: 'agradecimiento', titulo: 'Solo agradece', intencion: 'agradecimiento', accion: 'omitir', cierre: false,
    disparadores: ['gracias', 'muchas gracias', 'mil gracias', 'gracias por la informacion', 'te agradezco', 'ok gracias', 'gracias por todo', 'muy amable', 'gracias igualmente', 'gracias por responder', 'gracias a ti'],
    nota: 'Solo agradeció: no hace falta responder.',
  },
  {
    clave: 'acuse', titulo: 'Solo acusa recibo', intencion: 'acuse', accion: 'omitir', cierre: false,
    disparadores: ['ok', 'okey', 'listo', 'de acuerdo', 'entiendo', 'ya lo reviso', 'lo reviso', 'ya veo', 'oh okey', 'perfecto', 'claro', 'bueno', 'esta bien', 'ya vi', 'excelente', 'genial', 'ya', 'anotado', 'enterado', 'lo reviso luego'],
    nota: 'Solo acusó recibo: no hace falta responder.',
  },
  {
    clave: 'rechazo', titulo: 'No le interesa', intencion: 'rechazo', accion: 'responder', cierre: false,
    disparadores: ['no me interesa', 'no gracias', 'no estoy interesado', 'no estamos interesados', 'no por el momento', 'ahora no', 'no necesito', 'no lo necesito', 'no nos interesa', 'por ahora no', 'gracias pero no', 'no estoy interesada', 'no queremos', 'no por ahora'],
    respuestas: [
      'Entendido, gracias por tu tiempo. Si más adelante lo necesitas, aquí estamos.',
      'Gracias por avisar, sin problema. Si más adelante te interesa, me escribes por aquí.',
      'Perfecto, gracias por responder. Cuando quieras retomarlo, estoy a la orden.',
    ],
  },
  {
    clave: 'mas_tarde', titulo: 'Lo verá luego', intencion: 'rechazo', accion: 'responder', cierre: false,
    disparadores: ['yo le aviso', 'te aviso', 'luego te aviso', 'si me interesa te aviso', 'en un futuro', 'mas adelante', 'despues te escribo', 'luego te escribo', 'lo pienso', 'lo voy a pensar', 'lo consulto', 'lo veo con mi socio', 'dejame pensarlo', 'ahorita estoy ocupado', 'estoy ocupada', 'en otro momento', 'mas tarde lo veo', 'luego lo veo'],
    respuestas: [
      'Sin apuro, aquí sigo cuando quieras retomarlo.',
      'Perfecto, cuando lo veas me cuentas. Aquí estamos para lo que necesites.',
      'Claro, tómate tu tiempo. Si más adelante quieres verlo, me escribes por aquí.',
    ],
  },

  // ── Temas que NO responde sola: se los deja al propietario con una nota ─────
  {
    clave: 'baja', titulo: 'Pide que no le escriban más', intencion: 'baja', accion: 'traspasar',
    disparadores: ['no me escriban mas', 'dejen de escribirme', 'borren mi numero', 'stop', 'baja', 'ya no me escriban', 'ya basta de mensajes', 'basta de mensajes', 'ya basta', 'borrenme de su lista', 'borrame de la lista', 'sacame de la lista', 'no me molesten', 'no me contacten', 'elimina mi numero', 'darme de baja', 'quiero que dejen de escribirme'],
    nota: 'Pidió que no le escriban más: no le respondas y márcalo como baja (no volver a escribirle).',
  },
  {
    clave: 'queja', titulo: 'Molesto o desconfiado', intencion: 'queja', accion: 'traspasar',
    disparadores: ['estafa', 'spam', 'estoy molesto', 'denuncia', 'voy a reportar', 'acoso', 'no autorice', 'como consiguieron mi numero', 'de donde sacaron mi numero', 'quien les dio mi numero', 'esto es una estafa', 'es fraude', 'me estan molestando'],
    nota: 'Está molesto o desconfía (o pregunta de dónde sacamos su número): respóndele tú con cuidado.',
  },
  {
    clave: 'persona_o_bot', titulo: 'Pregunta si habla con una persona', intencion: 'bot', accion: 'traspasar',
    disparadores: ['eres un bot', 'eres un robot', 'eres una persona', 'hablo con una persona', 'es un bot', 'eres real', 'estoy hablando con un humano', 'es automatico', 'eres una maquina', 'es un robot', 'es una persona de verdad', 'hablo con un humano', 'esto es automatico', 'hablo con un bot'],
    nota: 'Preguntó si es una persona: respóndele tú.',
  },
  {
    clave: 'contacto_humano', titulo: 'Quiere hablar o que lo llamen', intencion: 'soporte', accion: 'traspasar',
    disparadores: ['me pueden llamar', 'llamame', 'quiero hablar con alguien', 'puedo hablar con un asesor', 'quiero hablar con un asesor', 'quiero hablar con una persona', 'quiero hablar con ustedes', 'tienen telefono', 'numero para llamar', 'un asesor', 'quiero que me llamen', 'llamenme', 'pueden llamarme', 'me llaman'],
    nota: 'Pide hablar con alguien o que lo llamen: contáctalo tú.',
  },
  {
    clave: 'factura_contrato', titulo: 'Factura, contrato o cancelación', intencion: 'soporte', accion: 'traspasar',
    disparadores: ['dan factura', 'facturan', 'factura', 'facturacion electronica', 'ruc', 'hay contrato', 'contrato', 'permanencia', 'cancelar', 'como cancelo', 'cancelacion', 'reembolso', 'devolucion', 'hay que firmar algo', 'puedo cancelar cuando quiera'],
    nota: 'Pregunta por factura, contrato, permanencia o cancelación: no está entre mis respuestas, respóndele tú.',
  },
  {
    clave: 'descuento', titulo: 'Pide descuento o promoción', intencion: 'precio', accion: 'traspasar',
    disparadores: ['descuento', 'hay descuento', 'me hacen descuento', 'rebaja', 'promocion', 'oferta', 'algo mas barato', 'mas economico', 'precio especial', 'tienen paquetes mas baratos', 'cupon', 'me rebajan el precio', 'se puede negociar'],
    nota: 'Pide descuento o un precio especial: no ofrezco rebajas, decide tú.',
  },
  {
    clave: 'integraciones', titulo: 'Integraciones con otros sistemas', intencion: 'otro', accion: 'traspasar',
    disparadores: ['se integra con', 'integracion', 'sistema de facturacion', 'api', 'se conecta con mi sistema', 'con mi pos', 'con shopify', 'se conecta con mi tienda', 'con google', 'se sincroniza con', 'puedo conectarlo con'],
    nota: 'Pregunta por integraciones con otros sistemas: no sé qué soporta, respóndele tú.',
  },
  {
    clave: 'soporte_acceso', titulo: 'Problema de acceso o no ve el botón', intencion: 'soporte', accion: 'traspasar',
    disparadores: [
      'no me llego', 'no me llego el correo', 'no me llego la clave', 'no veo el boton', 'el boton no funciona', 'no puedo entrar', 'no me deja entrar', 'olvide mi clave', 'cambiar mi clave',
      'no abre el enlace', 'el enlace no funciona', 'no carga', 'no me aparece', 'no me llego el enlace', 'no me llegaron las credenciales', 'no me sale el boton', 'perdi mi clave',
    ],
    nota: 'Tiene un problema de acceso o no ve el botón: ayúdalo tú (no hay que improvisar otra forma de activarlo).',
  },
  {
    clave: 'varios_negocios', titulo: 'Tiene varios negocios o sucursales', intencion: 'otro', accion: 'traspasar',
    disparadores: ['tengo dos negocios', 'tengo varios negocios', 'tengo otra sucursal', 'dos locales', 'varias sucursales', 'tengo mas de un negocio', 'otro negocio', 'tengo tres locales', 'es para varias sucursales'],
    nota: 'Tiene más de un negocio o sucursal: hay un perfil por negocio, confirma tú cómo lo manejamos.',
  },
  {
    clave: 'horario_connexo', titulo: 'Pregunta cuándo atienden o dónde están', intencion: 'otro', accion: 'traspasar',
    disparadores: ['a que hora atienden', 'horario de atencion', 'hasta que hora', 'abren los sabados', 'donde estan', 'donde quedan', 'tienen oficina', 'son de ecuador', 'de que ciudad son', 'a que hora responden', 'atienden los fines de semana'],
    nota: 'Pregunta por horario u oficina de Connexo: no tengo ese dato, respóndele tú.',
  },
  {
    clave: 'numero_equivocado', titulo: 'Número equivocado o ya no tiene el negocio', intencion: 'baja', accion: 'traspasar',
    disparadores: ['numero equivocado', 'no soy yo', 'se equivoco', 'equivocado', 'no tengo negocio', 'no es mi negocio', 'ya no tengo el negocio', 'cerramos el negocio', 'se equivocaron de numero', 'no es este el negocio'],
    nota: 'Dice que es un número equivocado o que el negocio ya no existe: ofrece disculpas tú y márcalo como baja.',
  },
];

import type { EntradaBanco } from './waRecuerdo.ts';

/** Las semillas como entradas del banco (con id de mentira y sin historial): para probarlas sin base de datos. */
export function semillasComoEntradas(): EntradaBanco[] {
  return SEMILLAS.map((s) => ({
    id: `semilla:${s.clave}`, clave: s.clave, titulo: s.titulo, intencion: s.intencion, accion: s.accion,
    disparadores: s.disparadores, excluye: s.excluye ?? [], estados: s.estados ?? null,
    respuestas: (s.respuestas ?? []).map((t) => ({ t, o: 'fabrica' as const })),
    cierre: s.cierre ?? s.accion === 'responder', nota: s.nota ?? null, verificada: false, activo: true, origen: 'fabrica' as const,
    usos: 0, aprobados: 0, editados: 0, descartes: 0,
  }));
}
