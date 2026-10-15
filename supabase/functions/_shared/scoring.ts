// Cálculo del KODA Score (secciones 6 y 7.3), ahora relativo al ESPACIO de cada usuario.
//
//   puntaje = señales del prospecto (reglas globales, con los pesos propios del usuario)
//           + señales de su nicho (ciudades, rubros y palabras que él definió)
//           + lo que KODA aprendió de sus decisiones (±25 como máximo)
//
// Todo con desglose: nunca un número sin el porqué.
import { norm, rubroDe } from './rubros.ts';

export interface Rule { clave: string; descripcion: string; puntos: number; activa: boolean }
export interface ScoreLine { clave: string; descripcion: string; puntos: number }
export type Plan = 'CONECTA' | 'PRO' | 'ULTRA';

/** El espacio del usuario (tabla koda_perfil). */
export interface Perfil {
  rubros: string[];
  ciudades: string[];
  palabras_clave: string[];
  palabras_excluidas: string[];
  pesos: Record<string, number>;
  aprende: boolean;
}

export interface ProspectLite {
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  ciudad: string | null;
}

/** Lo que KODA recuerda del usuario (koda_memoria + koda_resumen). */
export interface Memoria {
  items: Map<string, { pos: number; neg: number }>;
  decisiones: number;
  pesoPos: number;
  pesoNeg: number;
}

/** Señales que dependen del espacio del usuario: se recalculan siempre, nunca se leen guardadas. */
const SENALES_NICHO = ['ciudad_objetivo', 'rubro_con_plantilla', 'palabra_clave', 'palabra_excluida'];
/** Reglas de seguridad: el usuario no puede reescribirlas ni el aprendizaje las puede compensar. */
const PROTEGIDAS = ['opt_out', 'ya_es_cliente', 'cerrado_permanente'];

export const CLAVE_APRENDIZAJE = 'aprendizaje_koda';
export const APRENDIZAJE_MAX = 25;
/** Decisiones necesarias para que KODA confíe del todo en lo aprendido. */
const DECISIONES_CONFIANZA = 8;
const DECISIONES_MINIMAS = 2;

function senalesDeNicho(p: ProspectLite, perfil: Perfil): string[] {
  const out: string[] = [];

  if (perfil.ciudades.length && p.ciudad) {
    const c = norm(p.ciudad);
    if (perfil.ciudades.some((x) => norm(x) === c)) out.push('ciudad_objetivo');
  }

  if (perfil.rubros.length && p.categoria) {
    const grupo = rubroDe(p.categoria);
    const cat = norm(p.categoria);
    if ((grupo && perfil.rubros.includes(grupo)) || perfil.rubros.some((r) => norm(r) === cat)) {
      out.push('rubro_con_plantilla');
    }
  }

  const texto = norm(`${p.nombre} ${p.categoria ?? ''} ${p.descripcion ?? ''}`);
  const aparece = (lista: string[]) => lista.some((k) => { const n = norm(k); return n.length >= 3 && texto.includes(n); });
  if (aparece(perfil.palabras_clave)) out.push('palabra_clave');
  if (aparece(perfil.palabras_excluidas)) out.push('palabra_excluida');

  return out;
}

const PREFIJO: Record<string, string> = { cat: 'rubro', ciudad: 'ciudad', tipo: 'tipo', tok: 'palabra' };

function etiqueta(feature: string, reglas: Map<string, Rule>): string {
  const i = feature.indexOf(':');
  const pre = feature.slice(0, i);
  const val = feature.slice(i + 1);
  if (pre === 'sig') return (reglas.get(val)?.descripcion ?? val).toLowerCase();
  return `${PREFIJO[pre] ?? pre} «${val}»`;
}

/**
 * Ajuste aprendido. Para cada característica del prospecto que KODA ya conoce calcula
 * qué tan "sí" o "no" ha sido para el usuario (con suavizado: una sola decisión pesa
 * poco), le resta la mitad del humor general del usuario (si acepta casi todo, aceptar
 * no distingue nada) y promedia las 6 más claras. La confianza crece con las decisiones.
 */
function aprendizaje(
  features: string[],
  mem: Memoria,
  reglas: Map<string, Rule>,
): { puntos: number; descripcion: string } | null {
  if (mem.decisiones < DECISIONES_MINIMAS) return null;

  const base = (mem.pesoPos - mem.pesoNeg) / (mem.pesoPos + mem.pesoNeg + 2);
  const vistas: { f: string; net: number }[] = [];
  for (const f of features) {
    const m = mem.items.get(f);
    if (!m) continue;
    const n = m.pos + m.neg;
    if (n < 1) continue;
    vistas.push({ f, net: (m.pos - m.neg) / (n + 2) - 0.5 * base });
  }
  if (!vistas.length) return null;

  vistas.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const top = vistas.slice(0, 6);
  const media = top.reduce((a, x) => a + x.net, 0) / top.length;
  const confianza = Math.min(1, mem.decisiones / DECISIONES_CONFIANZA);
  const puntos = Math.round(APRENDIZAJE_MAX * Math.max(-1, Math.min(1, media)) * confianza);
  if (puntos === 0) return null;

  const razones = top
    .filter((x) => (puntos > 0 ? x.net > 0 : x.net < 0))
    .slice(0, 2)
    .map((x) => etiqueta(x.f, reglas));
  const detalle = razones.length ? ` (${razones.join(' · ')})` : '';
  return {
    puntos,
    descripcion: puntos > 0
      ? `KODA aprendió de ti: se parece a lo que aceptaste${detalle}`
      : `KODA aprendió de ti: se parece a lo que descartaste${detalle}`,
  };
}

export interface ScoreInput {
  /** Señales guardadas del prospecto (prospect_signals.clave). */
  signals: string[];
  prospect: ProspectLite;
  rules: Rule[];
  /** Espacio del usuario; null = aún no lo configuró (rigen las reglas generales). */
  perfil: Perfil | null;
  /** Memoria de KODA sobre este usuario; null = aprendizaje apagado o vacío. */
  memoria: Memoria | null;
  /** Características del prospecto (koda_features); vacío si no hay memoria. */
  features: string[];
  /** El plan CONECTA / PRO / ULTRA es de Connexo: solo se sugiere a la cuenta propietaria. */
  esPropietario: boolean;
}

export function computeScore(input: ScoreInput): { score: number; desglose: ScoreLine[]; plan: Plan | null } {
  const { prospect, rules, perfil, memoria } = input;
  const reglas = new Map(rules.filter((r) => r.activa).map((r) => [r.clave, r]));

  const claves = input.signals.filter((k) => !SENALES_NICHO.includes(k));
  if (perfil) claves.push(...senalesDeNicho(prospect, perfil));

  const puntosDe = (r: Rule): number => {
    const propio = perfil?.pesos?.[r.clave];
    return !PROTEGIDAS.includes(r.clave) && typeof propio === 'number' && Number.isFinite(propio) ? propio : r.puntos;
  };

  const desglose: ScoreLine[] = [];
  for (const clave of new Set(claves)) {
    const regla = reglas.get(clave);
    if (!regla) continue;
    const puntos = puntosDe(regla);
    if (puntos !== 0) desglose.push({ clave, descripcion: regla.descripcion, puntos });
  }

  // Si hay una señal de seguridad, lo aprendido no puede "rescatar" al prospecto.
  const bloqueado = claves.some((k) => PROTEGIDAS.includes(k));
  if (memoria && perfil?.aprende !== false && !bloqueado) {
    const a = aprendizaje(input.features, memoria, reglas);
    if (a) desglose.push({ clave: CLAVE_APRENDIZAJE, descripcion: a.descripcion, puntos: a.puntos });
  }

  const raw = desglose.reduce((a, l) => a + l.puntos, 0);
  const score = Math.max(0, Math.min(100, raw));
  return { score, desglose, plan: input.esPropietario ? sugerirPlan(claves, score) : null };
}

function sugerirPlan(signals: string[], score: number): Plan {
  if (signals.includes('multi_sucursal')) return 'ULTRA';
  if (score >= 50 || signals.includes('ig_o_fb_activo')) return 'PRO';
  return 'CONECTA';
}
