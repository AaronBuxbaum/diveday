import Link from "next/link";
import { EarnedMomentLine } from "@/components/EarnedMoment";
import { groupLabelClass } from "@/components/ui/ledger";

/**
 * **The month's five figures, unboxed** — ADR 20260827-the-shops-shelves,
 * decision 3 ("Reports keeps its shape and sheds its chrome"), speaking
 * Clearwater (ADR 20260827-clearwater-surface-language, decisions 1 and 3).
 *
 * What this replaced was six `sectionCardClass` tiles in a three-column grid:
 * six bordered boxes at equal weight, none of which floats above anything, for
 * six numbers whose whole job is to be read in one sweep. Decision 1 says
 * elevation is earned and a resting panel is flat; six flat boxes are still
 * six boxes, so the boxes go and the hairlines stay. The figure is the ink now
 * — `text-3xl` semibold and `tabular-nums`, the ramp's figure size — over a
 * group label, with at most one quiet line beneath it and the baseline
 * comparison one step quieter than that.
 *
 * Five figures, not six: the tax tile left for the quiet line beside the CSV
 * door (the page owns that line), and the departure count folded into the
 * Seats figure's own subline, where it was always the denominator of.
 *
 * **The label is `groupLabelClass()`, never a copy of its spelling.** The
 * tracking value lives in one file and `ledger.test.tsx` sweeps `src/` for a
 * second copy of it.
 *
 * **At most one coral element, and it is the Waivers figure's earned line**
 * (decision 11's table, row "Reports"). `earned` is condition-derived by the
 * page and never stored; it replaces the detail line rather than joining it,
 * and it never animates — this page is a monthly read, so a month that closed
 * complete is a fact on arrival, not a thing that just happened.
 */

/** One figure in the row: a label, the number, and at most one line under it. */
export type MonthFigure = {
  /** Stable across renders; never rendered. */
  key: string;
  /** The group label — "Net revenue", "Tips". Already translated. */
  label: string;
  /** The figure itself, already formatted for the reader's locale and the shop's currency. */
  value: string;
  /** The one fact under the figure. Omitted where the figure speaks alone. */
  detail?: string;
  /**
   * `attention` sets the detail in warning ink — work somebody has to chase,
   * which on this page is unsigned waivers and nothing else. The word carries
   * the state either way; the ink never carries it alone.
   */
  detailTone?: "quiet" | "attention";
  /**
   * The earned line, in place of `detail`. Coral, so exactly one figure in the
   * row may ever carry one, and only while its condition holds.
   */
  earned?: string;
  /** "up 18% vs $6,690 in August 2025" — the baseline, one step quieter. */
  comparison?: string;
  /** One quiet jump to the surface behind the number (revenue → Orders). */
  link?: { href: string; label: string };
};

/**
 * Where the hairlines fall, from the figure's index alone.
 *
 * The row is one column on a phone, two from `sm`, and all five from `lg`, so
 * "is this figure the first in its visual row" has a different answer at each
 * width and the rules are stated per breakpoint rather than guessed:
 *
 * - a **rule above** every figure that starts a new visual row (the container
 *   draws the row's own top and bottom edges);
 * - a **gutter beside** every figure that does not.
 */
function figureCellClass(index: number): string {
  const rule =
    index === 0
      ? ""
      : // Second figure: its own row on a phone, beside the first from `sm` up.
        index === 1
        ? "border-t border-border sm:border-t-0"
        : "border-t border-border lg:border-t-0";
  const gutter =
    index === 0
      ? ""
      : // Odd figures are second-in-row at two columns and stay so at five.
        index % 2 === 1
        ? "sm:border-s sm:border-border sm:ps-6"
        : "lg:border-s lg:border-border lg:ps-6";
  return `py-5 pe-6 ${rule} ${gutter}`.replace(/\s+/g, " ").trim();
}

export function MonthFigures({
  /** Names the region for a screen reader; the row carries no visible heading. */
  label,
  figures,
}: {
  label: string;
  /** The month's five figures, in reading order. */
  figures: MonthFigure[];
}) {
  // A month with nothing in it renders no figure row at all rather than five
  // zeroes — the page's own empty state says what happened instead.
  if (figures.length === 0) return null;
  const lastSpansTheRow = figures.length % 2 === 1;
  return (
    <section aria-label={label}>
      <dl className="grid grid-cols-1 border-y border-border sm:grid-cols-2 lg:grid-cols-5">
        {figures.map((figure, index) => (
          <div
            key={figure.key}
            className={`${figureCellClass(index)}${
              // An odd count leaves the last figure alone in its two-column
              // row; spanning it keeps the hairline above it full width.
              lastSpansTheRow && index === figures.length - 1 ? " sm:col-span-2 lg:col-span-1" : ""
            }`}
          >
            <dt className={groupLabelClass()}>{figure.label}</dt>
            <dd className="mt-2">
              {/* The figure carries its own type rather than the `<dd>`
                  carrying it for everything inside — the lines beneath are a
                  different size, and inheriting one to override it three times
                  is how a ramp drifts. */}
              <span className="block text-3xl font-semibold tracking-tight tabular-nums">
                {figure.value}
              </span>
              {figure.earned ? (
                <EarnedMomentLine animate={false} className="mt-2">
                  {figure.earned}
                </EarnedMomentLine>
              ) : figure.detail ? (
                <span
                  className={`mt-2 block text-sm ${
                    figure.detailTone === "attention" ? "text-warning-strong" : "text-muted"
                  }`}
                >
                  {figure.detail}
                </span>
              ) : null}
              {figure.comparison ? (
                <span className="mt-1 block text-sm text-muted tabular-nums">
                  {figure.comparison}
                </span>
              ) : null}
              {figure.link ? (
                <Link
                  href={figure.link.href}
                  className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
                >
                  {figure.link.label}
                </Link>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
