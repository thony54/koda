/**
 * Gasto del mes en APIs de pago: Google Places (búsquedas) y WhatsApp de Meta (saludos).
 *
 * Son ESTIMACIONES calculadas con lo que KODA ya guarda: Meta no ofrece ninguna API para leer el saldo
 * (el monto exacto a pagar solo está en su «Billing Hub») y Google factura aparte en Google Cloud.
 * Las tarifas son constantes de aquí abajo: si Meta o Google cambian sus precios, se corrigen en este archivo.
 */
import { db } from '@/lib/supabase';
import { byOwner } from '@/lib/scope';

/** Meta · «Resto de Latinoamérica» (Ecuador) · mensaje de marketing ENTREGADO, tarifa vigente desde el 1-oct-2026. */
export const TARIFA_WA_MARKETING_USD = 0.074;

/** Google · Places API (New) · Text Search Enterprise (los datos de contacto y calificación que pide KODA). */
export const GOOGLE_PRECIO_USD = 0.035;
/** Google regala las primeras 1.000 búsquedas de este tipo cada mes. */
export const GOOGLE_GRATIS_MES = 1000;

export interface GastoGoogle {
  busquedas: number;
  /** Lo que sumaría sin el cupo gratis (la cifra con la que KODA controla el tope mensual). */
  sinGratis: number;
  gratisRestantes: number;
  /** Lo que Google cobraría de verdad: solo lo que pase del cupo gratis. */
  aPagar: number;
}

export interface GastoWhatsapp {
  /** Saludos que Meta confirmó como entregados (o leídos). */
  entregados: number;
  /** Salieron pero Meta aún no avisó si llegaron: se cuentan, porque casi todos llegan. */
  porConfirmar: number;
  /** No salieron (sin WhatsApp, experimento de Meta, frecuencia…): Meta no los cobra. */
  noSalieron: number;
  /** Saludos aprobados que Meta frenó por pagos pendientes (131042): esperan que pagues. */
  esperandoPago: number;
  tarifa: number;
  estimado: number;
}

export interface GastoMes {
  mes: string;
  google: GastoGoogle;
  /** null si el usuario no ve WhatsApp (solo el propietario manda saludos por Meta). */
  whatsapp: GastoWhatsapp | null;
  /** Lo que se espera pagar este mes entre ambos. */
  total: number;
}

function inicioDeMes(): Date {
  const ahora = new Date();
  return new Date(ahora.getFullYear(), ahora.getMonth(), 1);
}

async function gastoGoogle(desde: string): Promise<GastoGoogle> {
  const { data, error } = await byOwner(
    db.from('job_runs').select('costo_estimado').gte('started_at', desde).gt('costo_estimado', 0),
  );
  if (error) throw error;
  const filas = (data ?? []) as { costo_estimado: number | string | null }[];
  const busquedas = filas.length;
  const sinGratis = filas.reduce((a, r) => a + Number(r.costo_estimado ?? 0), 0);
  return {
    busquedas,
    sinGratis,
    gratisRestantes: Math.max(0, GOOGLE_GRATIS_MES - busquedas),
    aPagar: Math.max(0, busquedas - GOOGLE_GRATIS_MES) * GOOGLE_PRECIO_USD,
  };
}

async function gastoWhatsapp(desde: string): Promise<GastoWhatsapp> {
  const saludos = (estados: string[]) =>
    db.from('wa_mensajes')
      .select('id', { count: 'exact', head: true })
      .eq('direccion', 'saliente').eq('tipo', 'template').in('estado', estados)
      .gte('ts', desde);
  const [ent, pend, fall, bloq] = await Promise.all([
    saludos(['entregado', 'leido']),
    saludos(['enviado']),
    saludos(['fallido']),
    db.from('connexo_envios')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'aprobado').ilike('detalle', '%131042%'),
  ]);
  for (const r of [ent, pend, fall, bloq]) if (r.error) throw r.error;
  const entregados = ent.count ?? 0;
  const porConfirmar = pend.count ?? 0;
  return {
    entregados,
    porConfirmar,
    noSalieron: fall.count ?? 0,
    esperandoPago: bloq.count ?? 0,
    tarifa: TARIFA_WA_MARKETING_USD,
    estimado: (entregados + porConfirmar) * TARIFA_WA_MARKETING_USD,
  };
}

export async function getGastoMes(opts: { whatsapp: boolean }): Promise<GastoMes> {
  const inicio = inicioDeMes();
  const desde = inicio.toISOString();
  const mes = inicio.toLocaleDateString('es-EC', { month: 'long', year: 'numeric' });
  const [google, whatsapp] = await Promise.all([
    gastoGoogle(desde),
    opts.whatsapp ? gastoWhatsapp(desde) : Promise.resolve(null),
  ]);
  return {
    mes: mes.charAt(0).toUpperCase() + mes.slice(1),
    google,
    whatsapp,
    total: google.aPagar + (whatsapp?.estimado ?? 0),
  };
}
