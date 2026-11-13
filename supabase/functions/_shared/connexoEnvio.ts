// Reglas de «¿se le puede ofrecer Connexo a este negocio?» — una sola fuente para `koda-connexo`.
//
// Sin dependencias de Deno ni de Supabase a propósito: son funciones puras y se prueban con Node.
//
// La regla de oro (pedido del propietario, 2026-11-10): a un negocio NUNCA se le ofrece la plantilla dos veces.
// Eso incluye a quien dijo «ver más tarde», a quien nunca respondió y a quien pidió que no le escriban. Y no
// basta con el id del prospecto: el mismo negocio puede estar dos veces en la base (sucursales, OSM + Google)
// con el MISMO celular, así que el celular también cuenta.

/** Estados en los que el negocio nunca llegó a ver nada: se puede volver a intentar. */
export const ESTADOS_REINTENTABLES = ['error', 'sin_plantilla'];
/** Estados en los que ya salió (o está por salir) el saludo por WhatsApp: no se repite jamás. */
export const ESTADOS_CONTACTADOS = ['wa_enviado', 'aceptado', 'declinado', 'vencido'];

const MOVIL_EC_RE = /^5939\d{8}$/;
const soloDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/** Celular de Ecuador en E.164 (+5939XXXXXXXX) desde cualquier formato habitual, o null (fijos, extranjeros, basura).
 *  Igual a `koda_celular_ec()` de la migración 0015: si cambia una, cambia la otra. */
export function celularEC(raw: string | null | undefined): string | null {
  let d = soloDigitos(raw);
  if (d.startsWith('00')) d = d.slice(2);
  if (/^09\d{8}$/.test(d)) d = `593${d.slice(1)}`;
  else if (/^9\d{8}$/.test(d)) d = `593${d}`;
  return MOVIL_EC_RE.test(d) ? `+${d}` : null;
}

export interface ProspectoEnvio {
  id: string;
  owner_id: string;
  nombre: string;
  whatsapp: string | null;
  opt_out?: boolean | null;
  anonimizado?: boolean | null;
  status?: string | null;
}

export interface EnvioRegistrado {
  id: string;
  prospect_id: string | null;
  prospect_nombre: string;
  estado: string;
  whatsapp?: string | null;
}

export type CodigoOmision =
  | 'ajeno' | 'opt_out' | 'anonimizado' | 'status' | 'ya_enviado'
  | 'sin_celular' | 'sin_rubro' | 'celular_repetido' | 'repetido_en_lote';

export interface Omision {
  codigo: CodigoOmision;
  motivo: string;
  estado?: string;
}

/** Cómo se le explica al propietario que ese negocio ya está en el embudo. */
const YA_ESTA: Record<string, string> = {
  pendiente: 'Ya se está enviando a Connexo.',
  borrador: 'Ya está en Connexo, esperando tu aprobación.',
  aprobado: 'Ya está en Connexo, aprobado y listo para el WhatsApp.',
  wa_enviado: 'Ya se le envió el WhatsApp: espera su respuesta.',
  aceptado: 'Ya aceptó la prueba de Connexo.',
  declinado: 'Ya respondió «ver más tarde»: no se le vuelve a ofrecer.',
  vencido: 'Su invitación o su prueba ya venció: no se le vuelve a ofrecer.',
  descartado: 'Ya lo descartaste en Connexo.',
};

const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: 'enviando', borrador: 'borrador', aprobado: 'aprobado', wa_enviado: 'WhatsApp enviado', aceptado: 'aceptó',
  declinado: 'ver más tarde', vencido: 'vencido', descartado: 'descartado',
};

export const yaEstaEnConnexo = (estado: string): string => YA_ESTA[estado] ?? 'Ya fue enviado a Connexo.';

export interface ContextoEnvio {
  esPropietario: boolean;
  callerId: string;
  /** Rubro de KODA (rubroDe); null = no se reconoce el nicho. */
  rubro: string | null;
  /** Envío que ya tiene ESTE prospecto, si lo tiene. */
  propio?: EnvioRegistrado | null;
  /** Todos los envíos registrados con ese mismo celular (de cualquier prospecto, incluso borrado). */
  conMismoCelular?: EnvioRegistrado[];
  /** Celulares que ya van en esta misma tanda → nombre del negocio al que le tocó primero. */
  yaEnLote?: Map<string, string>;
}

/** Motivo por el que NO se envía este prospecto a Connexo, o null si está listo. */
export function evaluarEnvio(p: ProspectoEnvio, ctx: ContextoEnvio): Omision | null {
  // El aislamiento se aplica a mano porque la función usa service_role.
  if (!ctx.esPropietario && p.owner_id !== ctx.callerId) return { codigo: 'ajeno', motivo: 'No es tuyo.' };
  if (p.opt_out) return { codigo: 'opt_out', motivo: 'Pidió no ser contactado.' };
  if (p.anonimizado) return { codigo: 'anonimizado', motivo: 'Datos anonimizados.' };
  if (p.status === 'no_contactar') return { codigo: 'status', motivo: 'Lo marcaste como «No contactar».' };
  if (p.status === 'descartado') return { codigo: 'status', motivo: 'Lo descartaste en KODA.' };

  if (ctx.propio && !ESTADOS_REINTENTABLES.includes(ctx.propio.estado)) {
    return { codigo: 'ya_enviado', motivo: yaEstaEnConnexo(ctx.propio.estado), estado: ctx.propio.estado };
  }

  const celular = celularEC(p.whatsapp);
  if (!celular) return { codigo: 'sin_celular', motivo: 'No tiene un celular con WhatsApp (los fijos no reciben).' };
  if (!ctx.rubro) {
    return { codigo: 'sin_rubro', motivo: 'No se reconoce su rubro o Connexo no tiene una plantilla para él (la Estándar ya no se usa: coaches, consultores y similares no se envían). Clasifícalo antes de enviarlo.' };
  }

  const otro = (ctx.conMismoCelular ?? []).find(
    (e) => e.prospect_id !== p.id && e.id !== ctx.propio?.id && !ESTADOS_REINTENTABLES.includes(e.estado),
  );
  if (otro) {
    return {
      codigo: 'celular_repetido',
      motivo: `Ese celular ya está en Connexo como «${otro.prospect_nombre}» (${ETIQUETA_ESTADO[otro.estado] ?? otro.estado}): no se le escribe dos veces.`,
      estado: otro.estado,
    };
  }
  const gemelo = ctx.yaEnLote?.get(celular);
  if (gemelo) {
    return { codigo: 'repetido_en_lote', motivo: `Tiene el mismo celular que «${gemelo}», que ya va en este lote.` };
  }
  return null;
}

/** ¿Otro envío con ese celular ya recibió (o está recibiendo) el saludo? Es la última barrera antes del WhatsApp. */
export function saludoYaEnviado(
  envio: Pick<EnvioRegistrado, 'id' | 'whatsapp'>,
  registrados: EnvioRegistrado[],
): EnvioRegistrado | null {
  if (!envio.whatsapp) return null;
  return registrados.find(
    (e) => e.id !== envio.id && e.whatsapp === envio.whatsapp && ESTADOS_CONTACTADOS.includes(e.estado),
  ) ?? null;
}
