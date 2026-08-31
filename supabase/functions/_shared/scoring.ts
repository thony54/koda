// Cálculo del KODA Score a partir de señales y las reglas de la tabla
// scoring_rules (secciones 6 y 7.3).

export interface Rule { clave: string; descripcion: string; puntos: number; activa: boolean }
export interface ScoreLine { clave: string; descripcion: string; puntos: number }

export function computeScore(
  signalKeys: string[],
  rules: Rule[],
): { score: number; desglose: ScoreLine[]; plan: 'CONECTA' | 'PRO' | 'ULTRA' } {
  const byKey = new Map(rules.filter((r) => r.activa).map((r) => [r.clave, r]));
  const desglose: ScoreLine[] = [];
  for (const key of signalKeys) {
    const rule = byKey.get(key);
    if (rule) desglose.push({ clave: key, descripcion: rule.descripcion, puntos: rule.puntos });
  }
  const raw = desglose.reduce((a, l) => a + l.puntos, 0);
  const score = Math.max(0, Math.min(100, raw));
  return { score, desglose, plan: suggestPlan(signalKeys, score) };
}

function suggestPlan(signals: string[], score: number): 'CONECTA' | 'PRO' | 'ULTRA' {
  if (signals.includes('multi_sucursal')) return 'ULTRA';
  if (score >= 50 || signals.includes('ig_o_fb_activo')) return 'PRO';
  return 'CONECTA';
}
