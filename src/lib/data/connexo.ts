/**
 * Puente con Connexo Clients. Leer la lista es una consulta normal (RLS: solo quien puede
 * enviar, sobre lo suyo); enviar y refrescar estados pasa por la Edge Function `koda-connexo`,
 * que es la única que habla con el proyecto de Connexo.
 */
import { db, supabase } from '@/lib/supabase';
import { byOwner } from '@/lib/scope';

async function invokeConnexo<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('koda-connexo', { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const b = await ctx.json(); if (b?.error) msg = b.error; } catch { /* cuerpo no-JSON */ }
    }
    throw new Error(msg);
  }
  return data as T;
}

export type ConnexoEstado =
  | 'pendiente' | 'borrador' | 'aprobado' | 'wa_enviado' | 'aceptado'
  | 'declinado' | 'vencido' | 'descartado' | 'sin_plantilla' | 'error';

type Variante = 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary';

export const ESTADO_CONNEXO: Record<ConnexoEstado, { label: string; variant: Variante; hint: string }> = {
  pendiente:     { label: 'Enviando',      variant: 'default', hint: 'Registrado; esperando la respuesta de Connexo.' },
  borrador:      { label: 'Borrador',      variant: 'info',    hint: 'Perfil armado, esperando tu aprobación.' },
  aprobado:      { label: 'Aprobado',      variant: 'primary', hint: 'Aprobado, listo para el WhatsApp.' },
  wa_enviado:    { label: 'WhatsApp enviado', variant: 'warning', hint: 'Corre la prueba de 7 días.' },
  aceptado:      { label: 'Aceptó',        variant: 'success', hint: 'El negocio aceptó y recibió sus credenciales.' },
  declinado:     { label: 'Quizás después', variant: 'default', hint: 'Respondió que lo verá más adelante.' },
  vencido:       { label: 'Prueba vencida', variant: 'error',  hint: 'La prueba terminó y el perfil se desactivó.' },
  descartado:    { label: 'Descartado',    variant: 'default', hint: 'Lo descartaste.' },
  sin_plantilla: { label: 'Sin plantilla', variant: 'warning', hint: 'Su rubro aún no tiene plantilla en Connexo.' },
  error:         { label: 'Error',         variant: 'error',   hint: 'Falló el envío; se puede reintentar.' },
};

export interface ConnexoEnvio {
  id: string;
  owner_id: string;
  prospect_id: string | null;
  prospect_nombre: string;
  prospect_ciudad: string | null;
  categoria: string | null;
  rubro: string | null;
  job_id: string | null;
  busqueda_nombre: string | null;
  estado: ConnexoEstado;
  detalle: string | null;
  connexo_username: string | null;
  connexo_theme: string | null;
  enviado_at: string;
  actualizado_at: string;
}

export async function listEnvios(): Promise<ConnexoEnvio[]> {
  const { data, error } = await byOwner(
    db.from('connexo_envios')
      .select('id, owner_id, prospect_id, prospect_nombre, prospect_ciudad, categoria, rubro, job_id, busqueda_nombre, estado, detalle, connexo_username, connexo_theme, enviado_at, actualizado_at')
      .order('enviado_at', { ascending: false })
      .limit(500),
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as ConnexoEnvio[];
}

export interface ResultadoEnvio {
  prospect_id: string;
  nombre?: string;
  resultado: 'enviado' | 'omitido' | 'error';
  motivo?: string;
  estado?: ConnexoEstado;
  username?: string | null;
  theme?: string | null;
}

export async function enviarAConnexo(prospectIds: string[]): Promise<{ enviados: number; resultados: ResultadoEnvio[] }> {
  return invokeConnexo({ action: 'enviar', prospect_ids: prospectIds });
}

/** Pregunta a Connexo cómo van los envíos y actualiza el espejo local. */
export async function refrescarEstadosConnexo(): Promise<{ configurado: boolean; actualizados: number }> {
  return invokeConnexo({ action: 'estado' });
}
