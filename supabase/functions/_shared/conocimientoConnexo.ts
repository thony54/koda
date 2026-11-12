// Lo que el agente de la Bandeja sabe de Connexo. Es la ÚNICA fuente de hechos del agente: si algo no está aquí, no se afirma.
//
// Sale de: Manual de Capacitación y ficha de Planes y Plantillas (Connexo Clients), precios y hechos del producto de la web
// (Connexo Web, src/data/pricing.ts y CLAUDE.md) y el diseño del puente KODA → Connexo. Al cambiar un precio, una regla de la
// prueba o una plantilla, se actualiza AQUÍ y se redespliegan `koda-wa-inbox` y `koda-connexo`.
//
// Texto plano a propósito (sin backticks ni plantillas) para pegarlo tal cual dentro del prompt.

/** Precios en USD que el agente puede nombrar. Cualquier otro importe en una respuesta se bloquea (ver waAgente.ts). */
export const PRECIOS_PERMITIDOS: ReadonlySet<number> = new Set([
  9,    // PRO al mes
  97,   // PRO al año
  17,   // ULTRA al mes
  179,  // ULTRA al año
  108,  // PRO: 12 meses a precio mensual (9 x 12), para explicar el ahorro anual
  204,  // ULTRA: 12 meses a precio mensual (17 x 12)
  11,   // ahorro anual de PRO (108 - 97)
  25,   // ahorro anual de ULTRA (204 - 179)
]);

export const CONOCIMIENTO_CONNEXO = `
QUÉ ES CONNEXO
Connexo (Ecuador) es una plataforma de perfiles digitales profesionales. Cada negocio recibe una dirección propia, por ejemplo connexoapp.com/nombre-del-negocio, que muestra quién es, cómo contactarlo, qué vende, dónde está y qué puede hacer el cliente ahí mismo. No es una página estática: según el rubro, el perfil recibe pedidos, agenda citas o reservas, registra clientes en un club de fidelidad, captura contactos, muestra un catálogo con precios o da seguimiento a un pedido con un código.
Se comparte con un solo enlace o con un código QR: sirve para poner en la biografía de Instagram, Facebook y TikTok, en WhatsApp, en la tarjeta de presentación o en un letrero. Funciona en el navegador de cualquier teléfono o computador y se puede instalar como app sin pasar por ninguna tienda de aplicaciones.
El dueño edita desde su teléfono o computador con su correo y su clave; guarda y el cambio se ve al instante, sin esperas ni aprobaciones. No necesita programar, pagar hosting ni contratar a nadie.
Hay un perfil por negocio y una sola plantilla (el diseño según su rubro). Contacto de ventas de Connexo: este mismo WhatsApp, +593 99 430 7367. Sitio: web.connexoapp.com.

CÓMO ES LA DEMO QUE RECIBEN LOS NEGOCIOS (flujo de KODA)
Connexo arma gratis un perfil de demostración con los datos reales del negocio que ya están públicos (nombre, dirección, teléfono, redes, calificación en Google) y lo completa con fotos, textos y un catálogo de EJEMPLO propios de su rubro para que vea cómo quedaría ya armado. Lo de ejemplo es referencial y el negocio lo reemplaza con lo suyo.
El primer mensaje que recibe es un saludo de Connexo con dos botones de respuesta, «¡Sí, enviar demo!» y «Ver más tarde», y un tercer botón que lleva a la web de Connexo (web.connexoapp.com), donde se explica todo con detalle.
Si toca «¡Sí, enviar demo!», se activa su perfil y empieza su prueba gratis de 7 días desde ese momento. En ese instante le llega por este mismo WhatsApp el enlace de su perfil, el correo de acceso y una clave temporal que debe cambiar apenas entre. Durante la prueba tiene las funciones del plan ULTRA, que es el más completo.
Si toca «Ver más tarde», no se le insiste. Si no toca nada, la invitación vence a los 7 días.
La prueba no pide tarjeta ni pago. Si al terminar los 7 días no sigue con un plan, el perfil se suspende (quien lo abra ve una página de cuenta inactiva) y sus datos quedan guardados 30 días por si decide retomarlo.
El plan se asigna y se cambia desde el panel de administración de Connexo, no desde la cuenta del cliente: para pasar a un plan de pago el cliente lo coordina con Connexo por este WhatsApp.
Solo se activa con el botón del primer mensaje (o si el equipo de Connexo lo activa a mano). Si el cliente dice que no ve el botón o que no le llegó, no se improvisa otra forma: se pasa al propietario.

PLANES Y PRECIOS (en dólares)
CONECTA: es la prueba gratuita, sin precio publicado. Se corre con las funciones de PRO o de ULTRA.
PRO: 9 dólares al mes, o 97 dólares al año (pago único anual, ahorra 11 dólares frente a pagar 12 meses). Para el negocio que ya vende o agenda. Incluye todo lo de CONECTA más catálogo de productos o servicios (hasta 25), galería y álbumes de fotos, reseñas de clientes con aprobación previa, base de clientes y club de fidelidad con códigos, captura de contactos y editor de preguntas frecuentes.
ULTRA: 17 dólares al mes, o 179 dólares al año (ahorra 25 dólares frente a pagar 12 meses). Para operar el negocio entero dentro de la app. Incluye todo lo de PRO más catálogo sin tope con importación masiva desde Excel o CSV, reservas y citas con equipo y horarios propios, inventario con recetas y agotado automático, chat con los visitantes, archivos descargables, videos destacados (hasta 2), preguntas frecuentes publicadas en el perfil y mapa de calor de actividad por día y hora.
Todos los planes incluyen: perfil público completo (foto, portada, bio, contacto, ubicación), enlaces ilimitados, redes sociales, horarios de atención, código QR y tarjeta de contacto, analíticas de visitas, clics y conversión, y la app instalable. Según lo que el propietario les responde a los negocios, cualquiera de los planes incluye además una tarjeta NFC personalizada o una pulsera NFC para compartir el perfil con un toque.
Las reservas y citas dependen de la plantilla: en tiendas (E-commerce) las citas con vendedores entran desde PRO; en barbería, gastronomía, mascotas y salud las reservas son de ULTRA.
No hay otros planes ni otros precios. El agente no ofrece descuentos ni promociones: si el cliente pide rebaja, se pasa al propietario. No se publican costos de instalación: no se menciona ninguno.
Si preguntan por factura, formas de pago del plan, contratos, permanencia o cancelación, NO se inventa: se pasa al propietario.

CUATRO FORMAS DE COBRAR A SUS PROPIOS CLIENTES (en las plantillas con pedidos o reservas)
El negocio activa las que use: link de pago directo, PayPhone (pago con tarjeta sin salir del perfil), transferencia bancaria (banco, cuenta y titular a la vista) y WhatsApp (abre el chat con el detalle y el monto ya escritos). Quien pide ve solo las modalidades activas y el monto exacto. Si piden factura, el cliente la solicita desde la pantalla de confirmación con RUC y razón social.

LAS PLANTILLAS Y LO QUE LES DA CADA UNA
Estándar (profesionales, servicios, empresas): perfil clásico con enlaces, contacto, productos, reseñas, contactos capturados y chat.
Barbería (barberías, peluquerías, estética): servicios y productos por separado, club con sellos de fidelidad y reservas por barbero.
Gastronomía (restaurantes, cafeterías, bares): menú por categorías con platos estrella, pedidos en vivo con rastreo por código, club de clientes, y en ULTRA reservas de mesa e inventario con recetas que marca agotado solo.
E-commerce (tiendas de ropa y catálogos): carrito, entrega a domicilio o retiro, pedidos rastreables, club de clientes con descuentos y citas con vendedores.
Mascotas (veterinarias y pet shops): catálogo y farmacia, pedidos con despacho, citas con los datos de la mascota, historia médica por paciente y control de inventario en ULTRA.
Salud (consultorios, clínicas, dentistas, médicos): botón de emergencia, citas con datos del paciente, historia clínica descargable en PDF, club de pacientes y control de farmacia en ULTRA.
Artista (músicos, bandas, escuelas de música): lanzamientos, fechas de gira y tickets, tienda de merch, base de fans por campaña, y clases con horario semanal y cupos para escuelas y academias.
Inmobiliaria (agencias y corredores): portafolio de propiedades con galería, buscador por zona, asesores con enlace propio y procesos rastreables por código.
Sublimados (fábricas-tienda de sublimado, bordado, estampado y uniformes): catálogo con precios por volumen, pedidos mayoristas con cotización oficial, solicitud de muestra y club mayorista.
Gimnasio (gimnasios, crossfit, estudios de fitness): planes de membresía con matrícula, clases con horario, entrenadores, inscripción con carnet digital y cobros por las formas de pago del negocio.
Hotel (hoteles y hostales): habitaciones y servicios, buscador de disponibilidad en vivo, reserva directa con código de seguimiento sin sobreventa, y en ULTRA tarifas por temporada y bloqueo de fechas.
Librería (librerías y papelerías): catálogo con ISBN y stock, pedidos con apartado de ejemplares, encargos de libros que no tiene, lista de espera, y en ULTRA tarjetas de regalo y resumen del negocio.
Fotografía (fotógrafos y estudios): portafolio por series, paquetes con precio y qué incluye, reserva con agenda sin choques de horario, cotización, galería privada con clave para entregar las fotos y, en ULTRA, cobro del anticipo y resumen del estudio.

PREGUNTAS FRECUENTES Y CÓMO ENFOCARLAS
¿Es una página web? Es un perfil propio que hace lo que normalmente se le pide a una página, pero más directo: catálogo, pedidos o citas, contacto por WhatsApp, redes y ubicación en un solo enlace que se comparte por cualquier red. No hay que pagar hosting ni programar y se edita desde el teléfono. Si ya tiene página web, convive: el perfil es el enlace que se pone en las redes y en WhatsApp.
¿Funciona para todas las redes sociales? Sí: es un solo enlace que se pone en la biografía de Instagram, Facebook, TikTok y en WhatsApp, y sirve también como código QR impreso.
¿Cuánto cuesta? Probarlo no cuesta nada: 7 días gratis con todo. Si decide seguir: PRO 9 dólares al mes o 97 al año, ULTRA 17 al mes o 179 al año.
¿Se paga todos los meses? Solo si decide quedarse después de la prueba. Se paga mensual o, si prefiere, un solo pago anual que le sale más barato. Si no sigue, no paga nada.
¿Puedo tener mi propio dominio (tunegocio.com)? No: la dirección es connexoapp.com/nombre. No se promete dominio propio.
¿Tiene inteligencia artificial? El producto no tiene IA. No se promete ni se menciona.
¿Puedo cambiar las fotos y textos? Sí, todo: foto, portada, logo, colores, catálogo, horarios y enlaces, desde el panel, y se ve al instante.
¿Quién lo arma? Connexo arma la demo con los datos del negocio; después el dueño lo edita cuando quiera, sin depender de nadie.
¿Cuánto toma empezar? La demo ya está armada: al aceptar, recibe el enlace y las credenciales al instante.
¿Qué pasa si no me sirve? Al terminar los 7 días el perfil se suspende y no se cobra nada.
Cualquier cosa fuera de esto (integraciones con otros sistemas, facturación electrónica, contratos, descuentos, cambios a medida, quejas, temas legales o de pago) se pasa al propietario.

QUÉ NO EXISTE (no prometer nunca)
Dominio propio. Registro automático por cuenta propia (la cuenta la crea Connexo). Inteligencia artificial dentro del producto. Más de una plantilla por negocio. Planes distintos de CONECTA, PRO y ULTRA. Descuentos o promociones. Cambiar la plantilla o el plan desde la cuenta del cliente.
`.trim();
