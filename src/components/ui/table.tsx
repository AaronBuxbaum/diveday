import Link from "next/link";
import { tapTargetLinkClass } from "./button";

/**
 * Canonical data-table vocabulary. Every table wears this one design —
 * orders, reports, the blow-out cascade, backup deliveries, the departure
 * log, trip prep, the import preview — instead of the six slightly different
 * hand-typed class strings those pages grew independently.
 *
 * It is not staff-only, despite growing up on staff pages: the diver-facing
 * site-comparison table on the public trip page wears it too (2026-08-14, from
 * FU-20260813-public-briefing-table-vocabulary). One header voice reads as
 * considered rather than clerical, and a public table is still a table — so a
 * softer second dialect was deliberately *not* created. A public call site
 * adjusts through props (`flush`, `minWidth`, `shellClassName`), never a fork.
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
 * hand-rolled. The outer shell clips rounded corners; its inner scroll region
 * keeps wide tables usable on a phone. Separating those two responsibilities
 * prevents a first/last row hover from painting square beyond the card while
 * preserving sideways scrolling. `print:overflow-visible` keeps paper out of
 * the scroll rule entirely.
 *
 * Elevation follows containment, one rule: a table that *is* the surface
 * (orders, reports, the departure log) wears the card shell; a table already
 * inside a card says `flush` and brings no chrome of its own — the header
 * rule and row dividers carry the structure, and a nested border-in-border
 * box never happens. `shellClassName` may still add context framing (a
 * margin, a visibility switch, a thin border marking a scroll region).
 */
export function Table({
  minWidth,
  flush = false,
  shellClassName = "",
  className = "",
  children,
}: {
  /** Below this the shell scrolls sideways instead of crushing columns. */
  minWidth?: TableMinWidth;
  /** Chrome-less shell for a table nested inside an existing card. */
  flush?: boolean;
  /** Margins and visibility for the shell (e.g. `mt-6`, `hidden sm:block print:block`). */
  shellClassName?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`overflow-hidden print:overflow-visible ${
        flush ? "" : "rounded-2xl border border-border bg-surface shadow-sm"
      } ${shellClassName}`
        .replace(/\s+/g, " ")
        .trim()}
    >
      <div className="overflow-x-auto print:overflow-visible">
        <table
          className={`w-full table-layout-fixed text-sm ${minWidth ? MIN_WIDTH[minWidth] : ""} ${className}`.trim()}
          style={{ tableLayout: "fixed" }}
        >
          {children}
        </table>
      </div>
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
  scope = "col",
  className = "",
  children,
}: {
  /** Right-align the column name over its right-aligned figures. */
  numeric?: boolean;
  /** Fold this column away below the breakpoint (its content moves under the first cell). */
  hideBelow?: keyof typeof HIDE_BELOW;
  /**
   * `row` for the first cell of a body row when that cell *names* the row and
   * the other cells describe it — the public site-comparison table, where each
   * row is one dive site and every following cell is a fact about it. A screen
   * reader then announces the site name with each cell instead of leaving the
   * figures unattributed. It carries no header-row styling: the uppercase
   * voice lives on `THead`'s `tr`, so a row header is simply a bold cell.
   */
  scope?: "col" | "row";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <th
      scope={scope}
      className={`overflow-hidden bg-clip-padding px-4 py-3 font-semibold ${numeric ? "text-right" : ""} ${
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

/**
 * **A body row whose whole area is the target, when the row opens a record.**
 *
 * `docs/design/principles.md` §2 puts the floor at 44px, for one hand in glare
 * with wet fingers. A row-opening link is not the inline prose link WCAG
 * exempts — it is the *only* way into the record the row is about — and three
 * staff tables were shipping it as an 18px word: 34 of them on the gear
 * register, which a shop owner taps standing at the wall tagging cylinders
 * (issue #786).
 *
 * `relative` is what `RowLink`'s overlay positions against, and it lives here
 * rather than at the call site so a row can never be given the link without the
 * context that makes it work. `group` is for a call site that wants to style
 * the row from the link's state.
 */
export function Tr({ className = "", children, ...rest }: React.ComponentPropsWithoutRef<"tr">) {
  return (
    <tr
      className={`group relative transition-colors duration-200 hover:bg-surface-sunken ${className}`.trim()}
      {...rest}
    >
      {children}
    </tr>
  );
}

/**
 * The row's own link: **at least 44px tall**, and filling its cell.
 *
 * `docs/design/principles.md` §2 puts the floor at 44px. Three staff tables
 * were shipping an 18px word — 34 of them on the gear register, tapped
 * one-handed at the wall (issue #786).
 *
 * **`min-h-11` is the guarantee, and the overlay is not.** The pattern this was
 * lifted from (`DiverList`) is described in its own comment as stretching the
 * link across the whole `<tr>` via `after:inset-0` — and it does not, because
 * `Td` carries `overflow-hidden`, which clips the pseudo-element to the cell. I
 * probed it: a point at the far edge of a divers row does not land on the row's
 * link. That table passes the 44px floor for an unrelated reason — its link
 * wraps a `size-10` avatar, so the box is 44px tall by content.
 *
 * So the height is stated rather than inherited from whatever the cell happens
 * to contain, and the overlay is kept for what it actually does: make the whole
 * *cell* the target instead of the word inside it, which on a phone is the
 * difference between a 50px word and a 200px column. Removing `overflow-hidden`
 * to win the rest of the row is a change to every table in the app and belongs
 * on its own.
 *
 * **The focus ring is on the overlay, not the text**, so it traces the target a
 * pointer actually has; `outline-offset-[-2px]` pulls it just inside the cell's
 * edge.
 */
export function RowLink({
  href,
  onClick,
  className = "",
  children,
}: {
  href: string;
  /** For a client call site with something to cancel on navigate. */
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`${tapTargetLinkClass} after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-primary ${className}`.trim()}
    >
      {children}
    </Link>
  );
}

export function Td({
  numeric = false,
  muted = false,
  hideBelow,
  align = "top",
  pad = true,
  className = "",
  children,
}: {
  /** A figure: right-aligned, `tabular-nums`, never wrapped mid-number. */
  numeric?: boolean;
  /** Secondary ink for a supporting cell. */
  muted?: boolean;
  align?: "top" | "middle";
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
      className={`overflow-hidden bg-clip-padding ${align === "middle" ? "align-middle" : "align-top"} ${pad ? "px-4 py-3" : ""} ${
        numeric ? "text-right whitespace-nowrap tabular-nums" : ""
      } ${muted ? "text-muted" : ""} ${hideBelow ? HIDE_BELOW[hideBelow] : ""} ${className}`.trim()}
    >
      {children}
    </td>
  );
}
