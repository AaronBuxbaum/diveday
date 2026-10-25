import { EmptyState } from "@/components/EmptyState";
import { tapTargetLinkClass } from "@/components/ui/button";
import { GroupLabel } from "@/components/ui/group-label";
import { LedgerRow } from "@/components/ui/ledger";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { formatMonthDay, monthNames, shortMonthNames } from "@/lib/format";
import { formatReportMoney, type MonthlyReport } from "@/lib/reporting";
import type { ShopYearCell, ShopYearSummary } from "@/lib/shop-year";
import { shopPath } from "@/lib/staff-notices";
import { type MonthFigure, MonthFigures } from "./MonthFigures";
import { YearStrip, type YearStripCopy } from "./YearStrip";

/**
 * **The shop's year** (ADR 20260908-one-hand, decision 6, lever T): the log
 * read from far enough away. The sentence the year says, the strip of days,
 * four figures, and the sites in the order the shop dived them — above the
 * month page, which keeps its own shape and its own
 * money and is reached by the same segmented control that reached this.
 *
 * **No money here, on any of it.** The printed card this data draws leaves
 * the shop, so the figure a shop would least like a stranger to read is absent from
 * the read itself rather than filtered out at the last surface — see
 * `getShopYear` in `src/db/reporting.ts`.
 *
 * How many sites the ledger names before it folds the rest into one line. Five
 * is what the canvas draws and it is the number a reader takes in without
 * counting; the remainder row keeps the total honest rather than truncating it.
 */
const SITES_SHOWN = 5;

/**
 * **The year's money** (fourth UX review, item 25): net revenue, tax and tips
 * for the departures that have sailed this year, the figures an owner pages
 * ten months to add in January. Already formatted; the CSV is twelve month
 * rows of the same.
 */
export type YearMoney = {
  report: Pick<MonthlyReport, "revenueCents" | "taxCents" | "tipsCents" | "tipCount">;
  currency: string;
  csvHref: string;
  /** Counter money in the year with no tax split out (issue #2674); the line shows when above 0. */
  counterTaxIncludedCents?: number;
};

export function YearReport({
  year,
  lastYear,
  lines = [],
  money,
  locale,
  shopSlug,
  t,
}: {
  year: ShopYearSummary;
  /**
   * Last year's figure under this year's, already worded ("291 by this date
   * in 2025"; fifth loop, item 25). Absent until the shop has a second season.
   */
  lastYear?: { divers?: string; boats?: string };
  /** Quiet lines under the figures: the weather days, the cards issued here. */
  lines?: readonly string[];
  money?: YearMoney;
  locale: string;
  shopSlug: string;
  t: StaffTranslator;
}) {
  if (!year.hasActivity) {
    return <EmptyState title={t("reports.year.empty")} className="mt-8" />;
  }

  const months = monthNames(locale);
  const monthMarkers = monthMarkersFor(year.strip, shortMonthNames(locale)).map((marker) => ({
    ...marker,
    href: `${shopPath(shopSlug, "reports")}?month=${marker.key}`,
  }));
  // The day without its year: the page's own header already names the year,
  // and "Jun 22, 2026" inside a sentence about 2026 says it twice.
  const busiestDayLabel = year.busiestDay
    ? formatMonthDay(
        Number(year.busiestDay.day.slice(5, 7)),
        Number(year.busiestDay.day.slice(8, 10)),
        locale,
      )
    : null;
  const quietestMonthLabel = year.quietestMonth
    ? (months[year.quietestMonth.month - 1] ?? "")
    : null;

  // The four figures, in reading order. Two of them are a fact about a day and
  // a fact about a month, so their figure is the count and their line names
  // *which* day and which month — the same shape the month's Seats figure uses
  // for its own denominator.
  const figures: MonthFigure[] = [
    {
      key: "divers",
      label: t("reports.year.figures.diversLabel"),
      value: String(year.divers),
      detail: t("reports.year.figures.diversDetail", { count: year.daysAtSea }),
      comparison: lastYear?.divers,
    },
    {
      key: "boats",
      label: t("reports.year.figures.boatsLabel"),
      value: String(year.boatsOut),
      // A shop that names no hull on its departures still went to sea; the
      // figure says so and the line under it stays empty rather than inventing
      // a boat.
      detail:
        year.boats.length > 0
          ? year.boats
              .map((boat) =>
                t("reports.year.figures.boatDays", { name: boat.name, count: boat.days }),
              )
              .join(" · ")
          : undefined,
      comparison: lastYear?.boats,
    },
    {
      key: "busiest",
      label: t("reports.year.figures.busiestLabel"),
      value: String(year.busiestDay?.divers ?? 0),
      detail:
        busiestDayLabel && year.busiestDay
          ? t("reports.year.figures.busiestDetail", {
              day: busiestDayLabel,
              count: year.busiestDay.boats,
            })
          : undefined,
    },
    {
      key: "quietest",
      label: t("reports.year.figures.quietestLabel"),
      // Before a month has finished there is no quietest one, and the figure
      // says nothing rather than naming the month that is still running.
      value: year.quietestMonth ? String(year.quietestMonth.divers) : "—",
      detail:
        quietestMonthLabel && year.quietestMonth
          ? t("reports.year.figures.quietestDetail", {
              month: quietestMonthLabel,
              count: year.quietestMonth.boats,
            })
          : undefined,
    },
  ];

  const shownSites = year.sites.slice(0, SITES_SHOWN);
  const restSites = year.sites.slice(SITES_SHOWN);
  const restDives = restSites.reduce((total, site) => total + site.times, 0);

  return (
    <>
      <p className="mt-2 max-w-3xl text-lg leading-8">
        {t("reports.year.sentence", {
          divers: year.divers,
          boats: year.boatsOut,
          sites: year.siteCount,
        })}
        {busiestDayLabel ? ` ${t("reports.year.busiest", { day: busiestDayLabel })}` : ""}
        {quietestMonthLabel ? ` ${t("reports.year.quietest", { month: quietestMonthLabel })}` : ""}
      </p>

      {lines.length > 0 ? (
        <ul data-year-lines="" className="mt-3 space-y-1 text-sm text-muted tabular-nums">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {/* **One rhythm between the sections, and the stack owns it.** The strip
          used to take `mt-8`, the figures nothing, and the sites
          `mt-10`, so the pixel probe measured 0 then 40px between them and the
          strip's legend sat about 4px above the figures' top hairline. One
          `space-y-10` here, and no `mt-*` on anything inside it
          (forms-and-controls.md). */}
      <div className="mt-8 space-y-10">
        <section aria-label={t("reports.year.stripLabel")}>
          <YearStrip
            cells={year.strip}
            months={monthMarkers}
            copy={stripCopy(t, locale, year.firstDay)}
          />
          <p className="mt-2 flex justify-between text-xs text-muted">
            <span>{t("reports.year.stripQuiet")}</span>
            <span>{t("reports.year.stripFull")}</span>
          </p>
        </section>

        <MonthFigures label={t("reports.year.numbersLabel")} figures={figures} columns={4} />

        {money ? (
          <div>
            <MonthFigures
              label={t("reports.year.money.label")}
              columns={3}
              figures={[
                {
                  key: "revenue",
                  label: t("reports.metrics.revenueLabel"),
                  value: formatReportMoney(money.report.revenueCents, money.currency, locale),
                  detail: t("reports.year.money.revenueDetail"),
                },
                {
                  key: "tax",
                  label: t("reports.year.money.taxLabel"),
                  value: formatReportMoney(money.report.taxCents, money.currency, locale),
                },
                {
                  key: "tips",
                  label: t("reports.metrics.tipsLabel"),
                  value: formatReportMoney(money.report.tipsCents, money.currency, locale),
                  detail: t("reports.year.money.tipsDetail", { count: money.report.tipCount }),
                },
              ]}
            />
            {(money.counterTaxIncludedCents ?? 0) > 0 ? (
              <p className="mt-1 text-end text-sm text-muted">{t("reports.counterTaxIncluded")}</p>
            ) : null}
            <p className="mt-3 text-end text-sm">
              <a
                href={money.csvHref}
                className={`${tapTargetLinkClass} font-medium text-primary hover:underline`}
              >
                {t("reports.year.money.downloadYear")}
              </a>
            </p>
          </div>
        ) : null}

        {shownSites.length > 0 ? (
          <section aria-labelledby="year-sites">
            <GroupLabel
              as="h2"
              id="year-sites"
              meta={t("reports.year.sitesCount", { count: year.siteCount })}
            >
              {t("reports.year.sitesLabel")}
            </GroupLabel>
            <ul>
              {shownSites.map((site) => (
                <SiteRow key={site.siteId} site={site} shopSlug={shopSlug} t={t} />
              ))}
            </ul>
            {restSites.length > 0 ? (
              <p className="mt-3 text-end text-sm text-muted tabular-nums">
                {t("reports.year.sitesRest", { count: restSites.length, dives: restDives })}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </>
  );
}

/** The words on the strip's days, the year's and the month's alike (issue #2664). */
export function stripCopy(t: StaffTranslator, locale: string, firstDay: string): YearStripCopy {
  return {
    monthsLabel: t("reports.chooseMonth"),
    day: (cell: ShopYearCell) =>
      cell.boats > 0
        ? t("reports.year.stripDay", {
            day: formatCalendarDate(cell.day ?? firstDay, locale),
            divers: cell.divers,
            boats: cell.boats,
          })
        : t("reports.year.stripQuietDay", {
            day: formatCalendarDate(cell.day ?? firstDay, locale),
          }),
  };
}

/**
 * One site and the times the shop dived it, with the bar beside the number.
 *
 * A site the shop has since deleted still counts — the year is what happened —
 * but the page behind it is gone, so that row is a fact rather than a door.
 * Two calls rather than a spread props object: the door is a discriminated
 * union on `href`, deliberately, so a row cannot carry a link with no name for
 * it.
 */
function SiteRow({
  site,
  shopSlug,
  t,
}: {
  site: ShopYearSummary["sites"][number];
  shopSlug: string;
  t: StaffTranslator;
}) {
  const times = (
    <span className="flex items-center gap-3 text-sm text-muted tabular-nums">
      {t("reports.year.siteTimes", { count: site.times })}
      {/* The one place on this page a meter carries a count, and it is
          decorative: the number beside it is the same number. */}
      <ProgressBar
        aria-hidden="true"
        className="hidden h-[5px] w-24 shrink-0 lg:block"
        trackClassName="bg-surface-sunken"
        segments={[{ key: "times", fraction: site.share, className: "bg-primary" }]}
      />
    </span>
  );
  const name = <span className="font-medium">{site.name}</span>;
  return site.live ? (
    <LedgerRow
      stacked
      trailing={times}
      href={shopPath(shopSlug, "dive-sites", site.siteId)}
      linkLabel={site.name}
    >
      {name}
    </LedgerRow>
  ) : (
    <LedgerRow stacked trailing={times}>
      {name}
    </LedgerRow>
  );
}

/**
 * Which column each month starts in, for the markers above the strip. Read off
 * the strip itself rather than computed from the calendar, so a shop that
 * opened in May is labelled from May and the markers cannot drift from the
 * squares they name.
 */
function monthMarkersFor(
  cells: ShopYearCell[],
  months: string[],
): { key: string; label: string; column: number }[] {
  const markers: { key: string; label: string; column: number }[] = [];
  let seen = "";
  cells.forEach((cell, index) => {
    if (cell.day === null) return;
    const month = cell.day.slice(0, 7);
    if (month === seen) return;
    seen = month;
    markers.push({
      key: month,
      label: months[Number(month.slice(5, 7)) - 1] ?? "",
      column: Math.floor(index / 7) + 1,
    });
  });
  return markers;
}
