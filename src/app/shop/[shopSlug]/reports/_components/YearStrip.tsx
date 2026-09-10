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
 * **Decorative, and it says so.** Every fact the strip draws is written in
 * words one screen-inch away — the sentence above it and the four figures
 * below — so a screen reader is not asked to walk 239 squares to learn what
 * "2,907 divers" already told it. That is the same judgement the departure
 * ledger's meters make and for the same reason. The `title` on each day is for
 * a mouse, not for assistive technology.
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
};

export function YearStrip({
  cells,
  months,
  copy,
  className = "",
}: {
  cells: ShopYearCell[];
  /** The month markers above the strip: a label and the column it starts in (1-based). */
  months: { key: string; label: string; column: number }[];
  copy: YearStripCopy;
  className?: string;
}) {
  const weeks = Math.ceil(cells.length / 7);
  const columns = { gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` };
  return (
    <div className={className || undefined} aria-hidden="true">
      <div className="grid gap-[3px] text-[10px] text-muted tabular-nums" style={columns}>
        {months.map((month) => (
          <span key={month.key} style={{ gridColumnStart: month.column }}>
            {month.label}
          </span>
        ))}
      </div>
      <div className="mt-1 grid grid-flow-col grid-rows-7 gap-[3px]" style={columns}>
        {cells.map((cell, index) =>
          cell.day === null ? (
            // A square before the year's first day: the grid keeps the week's
            // shape, and nothing is drawn in it.
            // biome-ignore lint/suspicious/noArrayIndexKey: padding squares have no identity but their position.
            <span key={`pad-${index}`} className="aspect-square" />
          ) : (
            <span
              key={cell.day}
              title={copy.day(cell)}
              className={`aspect-square rounded-[2px] ${FILL_CLASS[cell.fill]} ${
                cell.isToday ? "outline-2 outline-foreground outline-offset-1" : ""
              }`.trim()}
            />
          ),
        )}
      </div>
    </div>
  );
}
