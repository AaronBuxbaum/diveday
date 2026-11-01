import Link from "next/link";
import { EarnedMomentLine } from "@/components/EarnedMoment";
import { tapTargetLinkClass } from "@/components/ui/button";
import { groupLabelClass } from "@/components/ui/group-label";
import { FIGURE_LARGE_CLASS } from "@/components/ui/typography";

/**
 * Unboxed monthly figures use the shared group label and earn emphasis only
 * for the conditional, non-animated waiver line (ADRs 20260827-the-shops-shelves,
 * decision 3, and 20260827-clearwater-surface-language, decisions 1, 3, 11).
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
  /**
   * The figure itself is the door to its list (visual review A05: Safety's
   * tiles, each a link to the list behind its count).
   */
  href?: string;
};

/** Breakpoint-specific hairlines and gutters align figures with ledger rows (K-573); shared with the loading skeleton. */
export function figureCellClass(index: number): string {
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
  return `py-5 ps-2 pe-2 sm:pe-6 ${rule} ${gutter}`.replace(/\s+/g, " ").trim();
}

/** Literal Tailwind grids shared by month and year rows (ADR 20260908-one-hand, decision 6, lever T; UX review 4, item 25). */
const FIGURE_COLUMNS = {
  3: "-mx-2 grid grid-cols-1 border-y border-border sm:grid-cols-2 lg:grid-cols-3",
  4: "-mx-2 grid grid-cols-1 border-y border-border sm:grid-cols-2 lg:grid-cols-4",
  5: "-mx-2 grid grid-cols-1 border-y border-border sm:grid-cols-2 lg:grid-cols-5",
} as const;

export function MonthFigures({
  /** Names the region for a screen reader; the row carries no visible heading. */
  label,
  figures,
  caption,
  columns = 5,
}: {
  label: string;
  /** One quiet line under the row, said once: the month's basis (visual review A06). */
  caption?: string;
  /** The month's five figures, in reading order. */
  figures: MonthFigure[];
  /** How many the row holds at `lg`. The hairline rules read the index alone and need no telling. */
  columns?: keyof typeof FIGURE_COLUMNS;
}) {
  // The page's empty state replaces an empty figure row.
  if (figures.length === 0) return null;
  const lastSpansTheRow = figures.length % 2 === 1;
  return (
    <section aria-label={label}>
      <dl className={FIGURE_COLUMNS[columns]}>
        {figures.map((figure, index) => (
          <div
            key={figure.key}
            className={`${figureCellClass(index)}${
              // Span the final figure when an odd count leaves it alone at `sm`.
              lastSpansTheRow && index === figures.length - 1 ? " sm:col-span-2 lg:col-span-1" : ""
            }`}
          >
            <dt className={groupLabelClass()}>{figure.label}</dt>
            <dd className="mt-2">
              {/* Keep the figure size on the value; its detail lines use a smaller size. */}
              {figure.href ? (
                <Link
                  href={figure.href}
                  className={`block ${FIGURE_LARGE_CLASS} hover:underline print:no-underline`}
                >
                  {figure.value}
                </Link>
              ) : (
                <span className={`block ${FIGURE_LARGE_CLASS}`}>{figure.value}</span>
              )}
              {/* One shared block aligns the first detail or comparison line (K-287). */}
              {figure.earned || figure.detail || figure.comparison ? (
                <div className="mt-2 space-y-1">
                  {figure.earned ? (
                    <EarnedMomentLine animate={false}>{figure.earned}</EarnedMomentLine>
                  ) : figure.detail ? (
                    <span
                      className={`block text-sm ${
                        figure.detailTone === "attention" ? "text-warning-strong" : "text-muted"
                      }`}
                    >
                      {figure.detail}
                    </span>
                  ) : null}
                  {figure.comparison ? (
                    <span className="block text-sm text-muted tabular-nums">
                      {figure.comparison}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {/* Preserve the 44px tap target without changing the 20px text line (K-288). */}
              {figure.link ? (
                // A link does nothing on paper, so it does not print (review F3).
                <span className="mt-2 flex h-5 items-center print:hidden">
                  <Link
                    href={figure.link.href}
                    className={`${tapTargetLinkClass} text-sm font-medium text-primary hover:underline`}
                  >
                    {figure.link.label}
                  </Link>
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {caption ? <p className="mt-2 text-sm text-muted">{caption}</p> : null}
    </section>
  );
}
