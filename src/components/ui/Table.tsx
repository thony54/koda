import React from 'react';

/**
 * Primitivas de tabla con el estilo denso de KODA: la tabla es la protagonista.
 * Encabezado en monoespaciada (etiqueta), separadores hairline, sin zebra —
 * el hover y la selección dan la jerarquía.
 */

export const Table: React.FC<React.TableHTMLAttributes<HTMLTableElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <div className="glass-panel w-full overflow-x-auto rounded-lg">
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
    className={`sticky top-0 z-10 border-b border-line bg-surface-elevated/60 ${className}`}
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
    className={`h-12 border-b border-line transition-colors last:border-b-0 hover:bg-veil/[0.04] ${className}`}
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
    className={`eyebrow whitespace-nowrap px-4 py-3 text-left font-medium ${className}`}
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
  <td className={`px-4 py-2 align-middle text-ink-primary ${className}`} {...props}>
    {children}
  </td>
);
