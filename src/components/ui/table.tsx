/**
 * Canonical data-table vocabulary. Every staff table wears this one design —
 * orders, reports, the blow-out cascade, backup deliveries, the departure
 * log, trip prep, the import preview — instead of the six slightly different
 * hand-typed class strings those pages grew independently.
 *
 * The pieces mirror the HTML they render, so a call site keeps full JSX
 * freedom over its cells (links, badges, a status folded under a name below
 * `sm`, a dynamic set of roll-call columns) while the vocabulary owns the
 * chrome: one shell, one header voice, one row divider, one density.
 *
 * The two responsive strategies both live here, deliberately:
 *
 * - **Fold**: columns a phone can live without carry `hideBelow`, and their
 *   content folds under the first cell in a `sm:hidden` line (the orders
 *   index is the worked example). For lists a staffer reads on the move.
 * - **Scroll**: desk- and print-first documents (departure log, import
 *   preview) keep every column and set `minWidth`; the shell scrolls
 *   sideways on a narrow screen and `print:` unclamps it so paper is never
 *   subject to the scroll rule — a clipped column on a printed packing list
 *   is a silent one.
 *
 * Numbers are trustworthy by inspection (design principle 6): a numeric
 * column says `numeric` on both its `Th` and `Td`, which right-aligns and
 * sets `tabular-nums` so digits line up down the column.
 */

const HIDE_BELOW = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
} as const;

/**
 * Scroll-strategy floors. Static strings on purpose — Tailwind cannot see an
 * interpolated arbitrary value — and each carries `print:min-w-0` so the
 * floor never forces a printed table wider than the paper.
 */
const MIN_WIDTH = {
  "36rem": "min-w-[36rem] print:min-w-0",
  "40rem": "min-w-[40rem] print:min-w-0",
  "45rem": "min-w-[45rem] print:min-w-0",
} as const;

export type TableMinWidth = keyof typeof MIN_WIDTH;

/**
 * The table plus its shell, as one piece so neither can be forgotten or
 * hand-rolled. The shell is `overflow-x-auto`, never `overflow-hidden`: a
 * clipped Amount column on a phone once silently swallowed the one figure
 * the orders index exists to show. `print:overflow-visible` keeps paper out
 * of the scroll rule entirely.
 */
export function Table({
  minWidth,
  shellClassName = "",
  className = "",
  children,
}: {
  /** Below this the shell scrolls sideways instead of crushing columns. */
  minWidth?: TableMinWidth;
  /** Margins and visibility for the shell (e.g. `mt-6`, `hidden sm:block print:block`). */
  shellClassName?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm print:overflow-visible ${shellClassName}`.trim()}
    >
      <table
        className={`w-full text-sm ${minWidth ? MIN_WIDTH[minWidth] : ""} ${className}`.trim()}
      >
        {children}
      </table>
    </div>
  );
}

/** The one header voice: a single row of quiet uppercase column names. */
export function THead({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <thead className={className || undefined}>
      <tr className="border-b border-border text-left text-xs tracking-wide text-muted uppercase">
        {children}
      </tr>
    </thead>
  );
}

export function Th({
  numeric = false,
  hideBelow,
  className = "",
  children,
}: {
  /** Right-align the column name over its right-aligned figures. */
  numeric?: boolean;
  /** Fold this column away below the breakpoint (its content moves under the first cell). */
  hideBelow?: keyof typeof HIDE_BELOW;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 font-semibold ${numeric ? "text-right" : ""} ${
        hideBelow ? HIDE_BELOW[hideBelow] : ""
      } ${className}`.trim()}
    >
      {children}
    </th>
  );
}

export function TBody({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  // `break-inside-avoid` on every row: a printed row that splits across a
  // page boundary separates a diver from their roll-call marks on the one
  // document that exists for an emergency. Free on screen — the property
  // only acts in fragmentation contexts (print).
  return (
    <tbody className={`divide-y divide-border [&>tr]:break-inside-avoid ${className}`.trim()}>
      {children}
    </tbody>
  );
}

export function Td({
  numeric = false,
  muted = false,
  hideBelow,
  pad = true,
  className = "",
  children,
}: {
  /** A figure: right-aligned, `tabular-nums`, never wrapped mid-number. */
  numeric?: boolean;
  /** Secondary ink for a supporting cell. */
  muted?: boolean;
  hideBelow?: keyof typeof HIDE_BELOW;
  /**
   * Opt out of the cell padding **only** for a tbody that reflows its rows to
   * stacked lines below `sm` (the backup delivery history), where the row
   * owns the padding and each cell is an inline fragment. Everything shaped
   * like a grid keeps the default.
   */
  pad?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <td
      className={`align-top ${pad ? "px-4 py-3" : ""} ${
        numeric ? "text-right whitespace-nowrap tabular-nums" : ""
      } ${muted ? "text-muted" : ""} ${hideBelow ? HIDE_BELOW[hideBelow] : ""} ${className}`.trim()}
    >
      {children}
    </td>
  );
}
