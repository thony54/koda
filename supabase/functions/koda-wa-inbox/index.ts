// koda-wa-inbox: entrada de la bandeja de WhatsApp de Connexo (migración 0016).
//
// La llama SOLO Connexo (`kodaWhatsApp`) cada vez que Meta le avisa de algo en el número de Connexo, y cuando envía un
// saludo. Se autentica con el secreto compartido (`x-koda-secret` = CONNEXO_BRIDGE_SECRET), no con un JWT de usuario:
// por eso se despliega con verify_jwt = false (ver supabase/config.toml). Todo lo que hace es idempotente: Meta
// reintenta y Connexo reintenta, y nada se duplica.
//
// Acciones (todas con { v: 1 }):
//   { action: 'eventos', phone_id, payload } → guarda mensajes y avisos de estado del webhook de Meta. Solo los del número
//        `phone_id` (nunca de otra cuenta de WhatsApp). Los archivos se bajan en segundo plano.
//   { action: 'saludos', items: [{ wa_id, wamid, nombre?, plantilla?, ts? }] } → registra los saludos enviados.
//
// Secrets: CONNEXO_BRIDGE_SECRET (el mismo que ya usa koda-connexo). Opcional: CONNEXO_WA_PHONE_ID (si está, manda sobre
// el `phone_id` que diga Connexo: segunda barrera contra eventos de otro número).
import { corsHeaders, json } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/supabaseAdmin.ts';
import { aplicarEventos, guardarArchivo, registrarSaludos, type BandejaDb, type SaludoEnviado } from '../_shared/waBandeja.ts';
import { llamarWa } from '../_shared/connexoWa.ts';

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { ...corsHeaders, 'Access-Control-Allow-Headers': `${corsHeaders['Access-Control-Allow-Headers']}, x-koda-secret` } });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  const secret = Deno.env.get('CONNEXO_BRIDGE_SECRET') ?? '';
  const recibido = req.headers.get('x-koda-secret') ?? '';
  if (!secret || !safeEqual(recibido, secret)) return json({ error: 'No autorizado.' }, 401);

  try {
    // deno-lint-ignore no-explicit-any
    const body: Record<string, any> = await req.json().catch(() => ({}));
    if (body.v !== 1) return json({ error: 'Versión de contrato no soportada (se espera 1).' }, 400);
    const db = getAdminClient() as unknown as BandejaDb;

    if (body.action === 'eventos') {
      const phoneId = (Deno.env.get('CONNEXO_WA_PHONE_ID') || String(body.phone_id ?? '')) || null;
      const r = await aplicarEventos(db, body.payload, phoneId);
      // Los archivos bajan en segundo plano: el mensaje ya está guardado y se ve al instante.
      if (r.archivos.length) {
        const tarea = Promise.all(r.archivos.map((a) => guardarArchivo(db, llamarWa, a)));
        if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) EdgeRuntime.waitUntil(tarea); else await tarea;
      }
      return json({ ok: true, mensajes: r.mensajes, duplicados: r.duplicados, estados: r.estados, ignorados: r.ignorados });
    }

    if (body.action === 'saludos') {
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 500) as SaludoEnviado[];
      const r = await registrarSaludos(db, items);
      return json({ ok: true, ...r });
    }

    return json({ error: 'Acción desconocida.' }, 400);
  } catch (e) {
    // 500 → Connexo responde 500 al webhook y Meta reintenta (todo es idempotente).
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
