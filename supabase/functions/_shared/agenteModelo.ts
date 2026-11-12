// El modelo real del agente de la Bandeja: Claude, a través del SDK oficial de Anthropic.
// Solo para Edge Functions (usa Deno y npm:). La lógica del agente y sus pruebas viven en waAgente.ts, que no depende de esto.
//
// Secreto (Supabase de KODA): ANTHROPIC_API_KEY. Se guarda con `npx supabase secrets set ANTHROPIC_API_KEY=...` (nunca en el chat).
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import { ESQUEMA_RESPUESTA, type LlamarModelo } from './waAgente.ts';

export class SinClaveAnthropic extends Error {
  constructor() {
    super('Falta el secreto ANTHROPIC_API_KEY en Supabase (proyecto de KODA): el agente no puede redactar hasta que lo guardes.');
    this.name = 'SinClaveAnthropic';   // waAgente.ts (sin Deno) la reconoce por el nombre
  }
}

export const claveAnthropicConfigurada = (): boolean => !!Deno.env.get('ANTHROPIC_API_KEY');

const MAX_TOKENS = 8000;      // el razonamiento del modelo cuenta aquí; la respuesta en sí son unas 100 palabras
const TIMEOUT_MS = 90_000;

export function crearLlamarModelo(): LlamarModelo {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new SinClaveAnthropic();
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: TIMEOUT_MS });

  return async ({ modelo, esfuerzo, system, usuario }) => {
    const r = await client.messages.create({
      model: modelo,
      max_tokens: MAX_TOKENS,
      // El prompt fijo (instrucciones + conocimiento) se cachea: las siguientes llamadas lo leen casi gratis.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: usuario }],
      output_config: {
        effort: esfuerzo as 'low' | 'medium' | 'high',
        format: { type: 'json_schema', schema: ESQUEMA_RESPUESTA as unknown as Record<string, unknown> },
      },
    });
    const uso = {
      entrada: r.usage.input_tokens,
      salida: r.usage.output_tokens,
      cache_leido: r.usage.cache_read_input_tokens ?? 0,
      cache_escrito: r.usage.cache_creation_input_tokens ?? 0,
    };
    if (r.stop_reason === 'refusal') return { json: null, uso, rechazo: true };
    if (r.stop_reason === 'max_tokens') return { json: null, uso, truncado: true };
    let json: unknown = null;
    for (const b of r.content) {
      if (b.type !== 'text') continue;
      try { json = JSON.parse(b.text); } catch { json = null; }
      break;
    }
    return { json, uso };
  };
}
