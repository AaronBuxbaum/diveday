import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { weatherCallsInWindow } from "@/db/blowouts";
import type { DbExecutor } from "@/db/client";
import {
  certifiedHere,
  earliestReportedTripStart,
  getShopYear,
  getYearToDate,
} from "@/db/reporting";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { Role } from "@/lib/authz";
import { formatTimeZoneName, joinFacts, monthNames } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { summarizeMonth } from "@/lib/reporting";
import { summarizeShopYear } from "@/lib/shop-year";
import { shopPath } from "@/lib/staff-notices";
import { sameMomentYearBefore, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { StaffSectionTabs } from "../../_components/StaffSectionTabs";
import { ReportRangeTabs } from "./ReportRangeTabs";
import { YearReport } from "./YearReport";

/**
 * **The year is the other reading of the same page** (ADR 20260908-one-hand,
 * decision 6, lever T): same route, same gate, same locale, chosen by one
 * segmented control. Its own component so the month's page stays thin.
 *
 * The year's money (fourth UX review, item 25) is one more read beside the
 * year's facts: the month report over every departure of the year that left
 * before now, so "this year" counts what sailed, as the strip does.
 *
 * **A year switch, and last year beside the figures** (fifth loop, item 25):
 * `?year=` opens any year the shop has sailed in, so January 1 does not take
 * last year away, and once a shop has a second season each figure carries
 * last year's to the same date ("291 by this date in 2025"). The weather days
 * (item 27) and the cards the shop issued (item 32) are two lines under the
 * figures.
 */
export async function YearView({
  db,
  shop,
  shopSlug,
  roles,
  locale,
  now,
  requestedYear,
  t,
}: {
  db: DbExecutor;
  shop: { id: string; timezone: string; currency: string };
  shopSlug: string;
  roles: readonly Role[];
  locale: string;
  now: Date;
  /** `?year=`, unparsed; anything that is not a year the shop sailed in reads as this one. */
  requestedYear?: string;
  t: StaffTranslator;
}) {
  const tz = shop.timezone;
  const currency = toShopCurrency(shop.currency);
  const thisYear = utcToWallTime(now, tz).year;
  const firstTrip = await earliestReportedTripStart(db, shop.id);
  const firstYear = firstTrip ? Math.min(utcToWallTime(firstTrip, tz).year, thisYear) : thisYear;
  const asked = requestedYear && /^\d{4}$/.test(requestedYear) ? Number(requestedYear) : thisYear;
  const yearNumber = asked >= firstYear && asked <= thisYear ? asked : thisYear;
  const isThisYear = yearNumber === thisYear;
  // Last year "by this date" while this year runs; a past year against the
  // whole year before it.
  const lastYearNow = isThisYear ? sameMomentYearBefore(now, tz) : now;
  const window = (year: number, until?: Date) => {
    const end = wallTimeToUtc({ year: year + 1, month: 1, day: 1, hour: 0, minute: 0 }, tz);
    return {
      startUtc: wallTimeToUtc({ year, month: 1, day: 1, hour: 0, minute: 0 }, tz),
      endUtc: until && until < end ? until : end,
      timeZone: tz,
    };
  };
  const hasLastYear = yearNumber - 1 >= firstYear;
  const [yearInput, toDate, lastYearInput, weather, lastWeather, certified] = await Promise.all([
    getShopYear(db, shop.id, { timeZone: tz, year: yearNumber, now }),
    getYearToDate(db, shop.id, { timeZone: tz, currency, year: yearNumber, now }),
    hasLastYear
      ? getShopYear(db, shop.id, { timeZone: tz, year: yearNumber - 1, now: lastYearNow })
      : null,
    weatherCallsInWindow(db, shop.id, window(yearNumber, now)),
    hasLastYear ? weatherCallsInWindow(db, shop.id, window(yearNumber - 1, lastYearNow)) : null,
    certifiedHere(db, shop.id, window(yearNumber)),
  ]);
  const year = summarizeShopYear(yearInput);
  const lastYear = lastYearInput ? summarizeShopYear(lastYearInput) : null;
  const zone = formatTimeZoneName(locale, tz, now);
  const lastYearLine = (value: number) =>
    lastYear?.hasActivity
      ? t(isThisYear ? "reports.year.lastYearToDate" : "reports.year.lastYearWhole", {
          value,
          year: String(yearNumber - 1),
        })
      : undefined;
  const lines = [
    weather.departures > 0 || (lastWeather?.departures ?? 0) > 0
      ? joinFacts([
          t("reports.year.weatherDays", { days: weather.days, departures: weather.departures }),
          lastWeather ? lastYearLine(lastWeather.days) : null,
        ])
      : null,
    certified.total > 0
      ? joinFacts([
          t("reports.year.certifiedHere", { count: certified.total }),
          ...certified.byLevel.map((row) =>
            t("reports.year.certifiedLevel", {
              count: row.count,
              level: t(CERTIFICATION_LEVEL_KEYS[row.level]),
            }),
          ),
        ])
      : null,
  ].filter((line): line is string => line !== null);
  const reports = shopPath(shopSlug, "reports");
  const years = Array.from({ length: thisYear - firstYear + 1 }, (_, index) => thisYear - index);
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        title={t("shared.shopSections.money")}
        description={
          !isThisYear
            ? t("reports.year.rangeWhole", { year: String(year.year), zone })
            : year.sinceMonth
              ? t("reports.year.rangeSince", {
                  year: String(year.year),
                  month: monthNames(locale)[year.sinceMonth - 1] ?? "",
                  zone,
                })
              : t("reports.year.rangeSoFar", { year: String(year.year), zone })
        }
        actions={
          year.hasActivity ? (
            <a
              href={`${shopPath(shopSlug, "reports", "card")}${isThisYear ? "" : `?year=${yearNumber}`}`}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("reports.year.printCard")}
            </a>
          ) : undefined
        }
      />
      <StaffSectionTabs shopSlug={shopSlug} section="money" current="reports" roles={roles} t={t} />
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <ReportRangeTabs shopSlug={shopSlug} range="year" t={t} />
        {years.length > 1 ? (
          <SegmentedControl
            ariaLabel={t("reports.year.chooseYear")}
            currentKey={String(yearNumber)}
            currentIsLink
            ariaCurrentValue="true"
            scroll={false}
            items={years.map((option) => ({
              key: String(option),
              label: String(option),
              href:
                option === thisYear
                  ? `${reports}?range=year`
                  : `${reports}?range=year&year=${option}`,
            }))}
          />
        ) : null}
      </div>
      <YearReport
        year={year}
        lastYear={
          lastYear?.hasActivity
            ? { divers: lastYearLine(lastYear.divers), boats: lastYearLine(lastYear.boatsOut) }
            : undefined
        }
        lines={lines}
        money={{
          report: summarizeMonth(toDate),
          currency,
          csvHref: `${shopPath(shopSlug, "reports", "download")}?year=${year.year}`,
        }}
        locale={locale}
        shopSlug={shopSlug}
        t={t}
      />
    </main>
  );
}
