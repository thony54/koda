/**
 * Estilo compartido de Recharts: todo sale de los tokens CSS para que los
 * gráficos sigan el tema (oscuro/claro) sin colores sueltos.
 */

/** Acento Connexo — igual en ambos temas. */
export const CHART_ACCENT = '#ff6600';
export const CHART_PEACH = '#ffa35d';

export const gridStroke = 'var(--line)';

export const axisTick = {
  fontSize: 10,
  fill: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
};

export const categoryTick = {
  fontSize: 11,
  fill: 'var(--text-secondary)',
  fontFamily: 'var(--font-body)',
};

export const tooltipProps = {
  contentStyle: {
    background: 'rgb(var(--c-raised))',
    border: '1px solid var(--line-strong)',
    borderRadius: 10,
    fontSize: 12,
    padding: '8px 12px',
    boxShadow: 'var(--shadow-pop)',
  },
  labelStyle: {
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    marginBottom: 4,
  },
  itemStyle: { color: 'var(--text-primary)' },
  cursor: { fill: 'rgb(var(--c-accent) / 0.07)', stroke: 'none' },
};
