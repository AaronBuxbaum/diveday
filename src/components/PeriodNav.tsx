import Link from "next/link";
import { DiveDayIcon } from "@/components/DiveDayIcon";
import { buttonClass } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * **The one way a staff page chooses its period**: a Month | Year switch, and
 * under it the period's name between two arrows. Reports and Safety both draw
 * it, so the choice reads and works the same wherever a page is a month or a
 * year of the same record.
 *
 * The switch is the app's segmented control and the arrows are links, so a tap
 * is the change. The far edge of the range keeps its arrow, inert and
 * `aria-hidden`, so the title never shifts. The caller owns the hrefs (each
 * page has its own query grammar) and says which period is current; the words
 * come from the `reports` bundle, one set for both.
 */
export function PeriodNav({
  range,
  monthHref,
  yearHref,
  title,
  soFar = false,
  prevHref,
  nextHref,
  t,
  className = "mb-6",
}: {
  range: "month" | "year";
  /** Where the Month choice goes; the page's month, not necessarily today's. */
  monthHref: string;
  yearHref: string;
  /** The period's own name, already worded: "November 2026", "2026–27". */
  title: string;
  /** The period is still running. */
  soFar?: boolean;
  /** The step back, or null at the first period with anything in it. */
  prevHref: string | null;
  /** The step forward, or null at the current period. */
  nextHref: string | null;
  t: StaffTranslator;
  className?: string;
}) {
  const navClass = buttonClass({ variant: "secondary", size: "icon" });
  // Decorative and inert: the same box as a live arrow, with no pointer and no
  // hover fill, since the shared base carries `cursor-pointer`.
  const navDisabledClass = `${navClass} pointer-events-none opacity-40`;
  const year = range === "year";
  return (
    <div className={className}>
      <SegmentedControl
        ariaLabel={t("reports.year.rangeLabel")}
        currentKey={range}
        currentIsLink
        ariaCurrentValue="true"
        scroll={false}
        className="mb-6"
        items={[
          { key: "month", label: t("reports.year.thisMonth"), href: monthHref },
          { key: "year", label: t("reports.year.thisYear"), href: yearHref },
        ]}
      />
      <nav
        aria-label={t(year ? "reports.year.chooseYear" : "reports.chooseMonth")}
        className="flex items-center gap-3"
      >
        {prevHref ? (
          <Link
            href={prevHref}
            aria-label={t(year ? "reports.year.previous" : "reports.previousMonth")}
            className={`${navClass} shrink-0`}
            scroll={false}
          >
            <DiveDayIcon name="arrow-left" className="size-4" />
          </Link>
        ) : (
          <span
            aria-hidden="true"
            title={t(year ? "reports.year.earliestTitle" : "reports.earliestMonthTitle")}
            className={`${navDisabledClass} shrink-0`}
          >
            <DiveDayIcon name="arrow-left" className="size-4" />
          </span>
        )}
        <h2 className={`${SECTION_TITLE_CLASS} min-w-0 tabular-nums`}>
          {title}
          {soFar ? (
            <span className="ms-2 text-sm font-normal text-muted">{t("reports.soFar")}</span>
          ) : null}
        </h2>
        {nextHref ? (
          <Link
            href={nextHref}
            aria-label={t(year ? "reports.year.next" : "reports.nextMonth")}
            className={`${navClass} shrink-0`}
            scroll={false}
          >
            <DiveDayIcon name="arrow-right" className="size-4" />
          </Link>
        ) : (
          <span
            aria-hidden="true"
            title={t(year ? "reports.year.currentTitle" : "reports.currentMonthTitle")}
            className={`${navDisabledClass} shrink-0`}
          >
            <DiveDayIcon name="arrow-right" className="size-4" />
          </span>
        )}
      </nav>
    </div>
  );
}
