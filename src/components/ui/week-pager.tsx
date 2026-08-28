import Link from "next/link";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";

/**
 * **How a week-addressed surface steps between weeks** — two arrows, the range
 * it is showing, and a way back to the one the shop is in.
 *
 * Links, not buttons: each step is a whole reading of the surface and belongs
 * in the URL a staffer can keep open. The parameter behind them is `?week=`
 * (`src/lib/week-board.ts`), and it is deliberately one grammar across every
 * surface that reads a week — the schedule board (ADR
 * 20260827-clearwater-surface-language, decision 5) and the staffing week (ADR
 * 20260827-the-shops-shelves, decision 3). This component is that control
 * written once, after both surfaces had drawn their own copy of it.
 *
 * The words arrive already localized. It renders no state and holds none, so
 * it is safe on either side of the client boundary — the board's grid is a
 * Client Component and the staffing week is a Server one.
 */
export function WeekPager({
  rangeLabel,
  previousHref,
  nextHref,
  thisWeekHref,
  words,
  className = "",
}: {
  /** "Aug 24 – 30, 2026", formatted for the reader's locale. */
  rangeLabel: string;
  previousHref: string;
  nextHref: string;
  /** Null while the surface is already showing the current week — the control
   * is absent rather than disabled, because it would only reload what is on
   * screen. */
  thisWeekHref: string | null;
  words: { previous: string; next: string; thisWeek: string };
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      <Link
        href={previousHref}
        scroll={false}
        aria-label={words.previous}
        className={buttonClass({ variant: "secondary", size: "icon" })}
      >
        <DiveDayIcon name="chevron-left" />
      </Link>
      <Link
        href={nextHref}
        scroll={false}
        aria-label={words.next}
        className={buttonClass({ variant: "secondary", size: "icon" })}
      >
        <DiveDayIcon name="chevron-right" />
      </Link>
      <p className="ms-2 text-base font-semibold tracking-tight tabular-nums">{rangeLabel}</p>
      {thisWeekHref ? (
        <Link
          href={thisWeekHref}
          scroll={false}
          className={buttonClass({ variant: "link", size: "sm" })}
        >
          {words.thisWeek}
        </Link>
      ) : null}
    </div>
  );
}
