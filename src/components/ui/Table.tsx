import React from 'react';

/**
 * Primitivas de tabla con el estilo denso de KODA (sección 10.2):
 * filas de 44px, zebra sutil, encabezado fijo. La tabla es la protagonista,
 * así que estas primitivas priorizan densidad sobre aire.
 *
 * La ProspectTable con orden/filtros de servidor (TanStack Table) se arma en
 * la Fase 1 sobre estas primitivas.
 */

export const Table: React.FC<React.TableHTMLAttributes<HTMLTableElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <div className="w-full overflow-x-auto rounded-lg border border-line">
    <table className={`w-full border-collapse text-sm ${className}`} {...props}>
      {children}
    </table>
  </div>
);

export const THead: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <thead
    className={`bg-surface-elevated text-ink-secondary sticky top-0 z-10 ${className}`}
    {...props}
  >
    {children}
  </thead>
);

export const TBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <tbody className={className} {...props}>
    {children}
  </tbody>
);

export const TR: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <tr
    className={`h-11 border-b border-line odd:bg-transparent even:bg-white/[0.02] hover:bg-[var(--primary-orange)]/5 transition-colors ${className}`}
    {...props}
  >
    {children}
  </tr>
);

export const TH: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <th
    className={`px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap ${className}`}
    {...props}
  >
    {children}
  </th>
);

export const TD: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <td className={`px-3 py-2 text-ink-primary align-middle ${className}`} {...props}>
    {children}
  </td>
);
