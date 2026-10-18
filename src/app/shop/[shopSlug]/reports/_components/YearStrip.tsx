import Link from "next/link";
import { Fragment } from "react";
import type { ShopYearCell, ShopYearFill } from "@/lib/shop-year";

/**
 * **The year as fifty-odd weeks of days** (ADR 20260908-one-hand, decision 6,
 * lever T) — one square per day, seven rows deep, the water deepening with how
 * full that day's boats were, today outlined, and nothing at all after today.
 *
 * Drawn in the app's own tokens rather than copied off the canvas: the fills
 * are the lagoon at four strengths, so the strip follows the palette into the
 * night scheme and into boat mode without a second definition. Squares are
 * `aspect-square` inside an explicit column count, so the same fifty-three
 * columns fit a 390px phone at 5px and a desktop column at 16px without the
 * page ever scrolling sideways.
 *
 * **The months are doors** (#2434): each label links to its own month's
 * report, so a far month is one tap rather than a walk along the arrows. On a
 * phone the doors are a row of month chips above the strip, 44 by 44px at
 * least, and the strip's own labels are plain words (#2573).
 *
 * **The squares are decorative, and say so.** Every fact the strip draws is written in
 * words one screen-inch away — the sentence above it and the four figures
 * below — so a screen reader is not asked to walk 239 squares to learn what
 * "2,907 divers" already told it. That is the same judgement the departure
 * ledger's meters make and for the same reason. The `title` on each day is for
 * a mouse, not for assistive technology.
 *
 * **Two shapes of one strip** (issue #2664). The year lays its days out in
 * weeks, seven rows deep; the month is one row of its 28 to 31 days, the same
 * squares on the same four fills, sized to the whole month so a month still
 * running keeps its squares and leaves the days to come blank.
 */

/** The lagoon at four strengths: no boat, a thin boat, a good boat, a full one. */
const FILL_CLASS: Record<ShopYearFill, string> = {
  0: "bg-surface-sunken",
  1: "bg-primary/25",
  2: "bg-primary/55",
  3: "bg-primary",
};

export type YearStripCopy = {
  /** "Jul 4 · 44 divers on 3 boats" — hover, never read aloud. */
  day: (cell: ShopYearCell) => string;
  /** The name of the row of month links. */
  monthsLabel: string;
};

export function YearStrip({
  cells,
  months = [],
  copy,
  row,
  className = "",
}: {
  cells: ShopYearCell[];
  /** The month markers above the strip: a label, the column it starts in (1-based), and its report. */
  months?: { key: string; label: string; column: number; href: string }[];
  copy: YearStripCopy;
  /**
   * One row of days instead of weeks: the month's strip. `days` is how many
   * days the row is wide, so a month still running keeps its squares' size.
   */
  row?: { days: number };
  className?: string;
}) {
  if (row) {
    return (
      <div
        className={`grid gap-[3px] ${className}`.trim()}
        style={{ gridTemplateColumns: `repeat(${row.days}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {cells.map((cell) =>
          cell.day === null ? null : <DaySquare key={cell.day} cell={cell} copy={copy} />,
        )}
      </div>
    );
  }
  const weeks = Math.ceil(cells.length / 7);
  const columns = { gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` };
  return (
    <div className={className || undefined}>
      {/* **Uneven on purpose.** Each month's label starts in the week column
          its first day falls in, so the space between two labels is four or
          five weeks wide, as the calendar is. The pixel probe's uneven-gaps
          check reads that as a broken rhythm (133.5/100.9px at 1280); spacing
          the labels evenly would put each one over the wrong weeks (settled
          in docs/design/settled-questions.md).

          **Wider than its column, also on purpose.** A label is anchored in
          the one week column its month starts in, which is narrower than the
          word, so it runs on over its own month's empty weeks; the next label
          is four or five weeks along, so nothing is overlapped or clipped.
          The probe's text-spill check reads the overrun as spill (settled
          there too).

          **Each label is its month's door**, spanning the weeks to the next
          label and 44px tall; the negative margin lets the target overhang
          the line, so the strip does not move (#2434). */}
      <nav aria-label={copy.monthsLabel}>
        {/* **On a phone the doors are chips**: twelve labels cannot each be 44px
            wide across 390px (the weeks a label spans are about 33px), so below
            `sm` the months are a row of 44 by 44px chips that scrolls sideways
            and the labels in the strip are plain words (#2573). */}
        <ul className="-mx-4 mb-1 flex gap-2 overflow-x-auto px-4 sm:hidden">
          {months.map((month) => (
            <li key={month.key} className="shrink-0">
              <Link
                href={month.href}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-surface-sunken px-3 text-sm font-medium text-foreground"
              >
                {month.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="grid gap-x-[3px] text-[10px] text-muted tabular-nums" style={columns}>
          {months.map((month, index) => {
            const gridColumn = `${month.column} / ${months[index + 1]?.column ?? weeks + 1}`;
            return (
              <Fragment key={month.key}>
                <span
                  aria-hidden="true"
                  style={{ gridColumn }}
                  className="-my-3.5 flex min-h-11 items-center sm:hidden"
                >
                  {month.label}
                </span>
                <Link
                  href={month.href}
                  style={{ gridColumn }}
                  className="-my-3.5 flex min-h-11 items-center underline-offset-2 hover:text-foreground hover:underline max-sm:hidden"
                >
                  {month.label}
                </Link>
              </Fragment>
            );
          })}
        </div>
      </nav>
      <div
        className="mt-1 grid grid-flow-col grid-rows-7 gap-[3px]"
        style={columns}
        aria-hidden="true"
      >
        {cells.map((cell, index) =>
          cell.day === null ? (
            // A square before the year's first day: the grid keeps the week's
            // shape, and nothing is drawn in it.
            // biome-ignore lint/suspicious/noArrayIndexKey: padding squares have no identity but their position.
            <span key={`pad-${index}`} className="aspect-square" />
          ) : (
            <DaySquare key={cell.day} cell={cell} copy={copy} />
          ),
        )}
      </div>
    </div>
  );
}

/**
 * One day's square. **Today's outline is drawn inside its square** (a negative
 * offset as wide as the outline). Outside it, a 2px ring at a 1px offset filled
 * the whole 3px gutter, touched the square above and ran 2px past the grid's
 * edge (K-572). Below `sm` a square is under 4px wide, so the ring thins to 1px
 * and the fill still shows.
 */
function DaySquare({ cell, copy }: { cell: ShopYearCell; copy: YearStripCopy }) {
  return (
    <span
      title={copy.day(cell)}
      className={`aspect-square rounded-[2px] ${FILL_CLASS[cell.fill]} ${
        cell.isToday
          ? "outline-2 -outline-offset-2 outline-foreground max-sm:outline-1 max-sm:-outline-offset-1"
          : ""
      }`.trim()}
    />
  );
}
