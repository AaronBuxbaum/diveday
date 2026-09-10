import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { GroupLabel, LedgerRow } from "@/components/ui/ledger";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { formatMonthDay, monthNames, shortMonthNames } from "@/lib/format";
import type { ShopYearCell, ShopYearSummary } from "@/lib/shop-year";
import { shopPath } from "@/lib/staff-notices";
import { type MonthFigure, MonthFigures } from "./MonthFigures";
import { YearStrip } from "./YearStrip";

/**
 * **The shop's year** (ADR 20260908-one-hand, decision 6, lever T): the log
 * read from far enough away. The sentence the year says, the strip of days,
 * four figures, the sites in the order the shop dived them, and the days it
 * closed out — above the month page, which keeps its own shape and its own
 * money and is reached by the same segmented control that reached this.
 *
 * **No money here, on any of it.** Two of the three things this data draws
 * leave the shop (the printed card, and the homepage band for a shop that said
 * yes), so the figure a shop would least like a stranger to read is absent from
 * the read itself rather than filtered out at the last surface — see
 * `getShopYear` in `src/db/reporting.ts`.
 *
 * How many sites the ledger names before it folds the rest into one line. Five
 * is what the canvas draws and it is the number a reader takes in without
 * counting; the remainder row keeps the total honest rather than truncating it.
 */
const SITES_SHOWN = 5;

/** How many close-outs the page lists before the rest become one line. */
const ENTRIES_SHOWN = 12;

export function YearReport({
  year,
  locale,
  shopSlug,
  t,
  showsOnDiveday,
}: {
  year: ShopYearSummary;
  locale: string;
  shopSlug: string;
  t: StaffTranslator;
  /** Whether this shop's year is on DiveDay's pages — the one line about the switch. */
  showsOnDiveday: boolean;
}) {
  if (!year.hasActivity) {
    return <EmptyState title={t("reports.year.empty")} className="mt-8" />;
  }

  const months = monthNames(locale);
  const monthMarkers = monthMarkersFor(year.strip, shortMonthNames(locale));
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
  const shownEntries = year.entries.slice(0, ENTRIES_SHOWN);
  const restEntries = year.entries.length - shownEntries.length;

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

      <section aria-label={t("reports.year.stripLabel")} className="mt-8">
        <YearStrip
          cells={year.strip}
          months={monthMarkers}
          copy={{
            day: (cell: ShopYearCell) =>
              cell.boats > 0
                ? t("reports.year.stripDay", {
                    day: formatCalendarDate(cell.day ?? year.firstDay, locale),
                    divers: cell.divers,
                    boats: cell.boats,
                  })
                : t("reports.year.stripQuietDay", {
                    day: formatCalendarDate(cell.day ?? year.firstDay, locale),
                  }),
          }}
        />
        <p className="mt-3 text-sm text-muted">{t("reports.year.stripLegend")}</p>
      </section>

      <MonthFigures label={t("reports.year.numbersLabel")} figures={figures} columns={4} />

      {shownSites.length > 0 ? (
        <section aria-labelledby="year-sites" className="mt-10">
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

      {shownEntries.length > 0 ? (
        <section aria-labelledby="year-entries" className="mt-10">
          <GroupLabel
            as="h2"
            id="year-entries"
            meta={t("reports.year.entriesCount", { count: year.entries.length })}
          >
            {t("reports.year.entriesLabel")}
          </GroupLabel>
          <ul>
            {shownEntries.map((entry) => (
              <LedgerRow key={entry.day} stacked>
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-medium tabular-nums">
                    {formatCalendarDate(entry.day, locale)}
                  </span>
                  <span className="text-muted">
                    {t("reports.year.entry", { divers: entry.divers, boats: entry.boats })}
                  </span>
                  <span className="text-sm text-muted">
                    {t("reports.year.entryClosedBy", { name: entry.actor })}
                  </span>
                </span>
              </LedgerRow>
            ))}
          </ul>
          {restEntries > 0 ? (
            <p className="mt-3 text-end text-sm text-muted tabular-nums">
              {t("reports.year.entriesRest", { count: restEntries })}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Where the card goes when it leaves the shop, and the one door that
          changes it. A quiet line rather than a section, on the tax line's
          pattern: it is a state and a door, not a heading's worth of page. */}
      <p className="mt-10 text-end text-sm text-muted">
        {showsOnDiveday ? t("reports.year.shareOn") : t("reports.year.shareOff")}
        {" · "}
        <Link
          href={shopPath(shopSlug, "settings", "display")}
          className="font-medium text-primary hover:underline"
        >
          {t("reports.year.shareDoor")}
        </Link>
      </p>
    </>
  );
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
