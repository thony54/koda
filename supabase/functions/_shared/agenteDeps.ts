// Las piezas reales del agente de la Bandeja (base, modelo, Connexo, reloj) para las Edge Functions.
import { getAdminClient } from './supabaseAdmin.ts';
import { llamarWa } from './connexoWa.ts';
import { crearLlamarModelo } from './agenteModelo.ts';
import type { BandejaDb, Json } from './waBandeja.ts';
import type { DepsAgente, LlamarModelo } from './waAgente.ts';

export function crearDepsAgente(): DepsAgente {
  let modelo: LlamarModelo | null = null;
  return {
    db: getAdminClient() as unknown as BandejaDb,
    // El cliente de Anthropic se crea la primera vez que hace falta (y falla claro si falta la clave).
    llamarModelo: () => (modelo ??= crearLlamarModelo()),
    llamarWa: (body: Json, timeoutMs?: number) => llamarWa(body, timeoutMs),
    dormir: (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
    aleatorio: Math.random,
    log: (...a) => console.error(...a),
  };
}
