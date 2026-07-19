import React from 'react';

/** Responsive overflow-x wrapper + styled <table>. */
export const Table: React.FC<React.TableHTMLAttributes<HTMLTableElement>> = ({
  className = '',
  children,
  ...rest
}) => (
  <div className="w-full overflow-x-auto rounded-2xl border border-white/10">
    <table className={`w-full border-collapse text-sm ${className}`} {...rest}>
      {children}
    </table>
  </div>
);

export const THead: React.FC<
  React.HTMLAttributes<HTMLTableSectionElement>
> = ({ className = '', children, ...rest }) => (
  <thead className={className} {...rest}>
    {children}
  </thead>
);

export const TBody: React.FC<
  React.HTMLAttributes<HTMLTableSectionElement>
> = ({ className = '', children, ...rest }) => (
  <tbody className={className} {...rest}>
    {children}
  </tbody>
);

export interface TRProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** apply hover highlight (default true for body rows) */
  hover?: boolean;
}

export const TR: React.FC<TRProps> = ({
  hover = true,
  className = '',
  children,
  ...rest
}) => (
  <tr
    className={`border-b border-white/10 last:border-0 ${
      hover ? 'transition-colors duration-200 hover:bg-white/[0.03]' : ''
    } ${className}`}
    {...rest}
  >
    {children}
  </tr>
);

export const TH: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({
  className = '',
  children,
  ...rest
}) => (
  <th
    scope="col"
    className={`text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-500 ${className}`}
    {...rest}
  >
    {children}
  </th>
);

export const TD: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({
  className = '',
  children,
  ...rest
}) => (
  <td className={`px-4 py-3 text-neutral-300 align-middle ${className}`} {...rest}>
    {children}
  </td>
);

export default Table;
