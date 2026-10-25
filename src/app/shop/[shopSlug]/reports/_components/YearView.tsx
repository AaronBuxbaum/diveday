import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { weatherCallsInWindow } from "@/db/blowouts";
import type { DbExecutor } from "@/db/client";
import { counterTaxIncluded } from "@/db/report-lines";
import {
  certifiedHere,
  earliestReportedTripStart,
  getShopYear,
  getYearToDate,
} from "@/db/reporting";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { Role } from "@/lib/authz";
import { joinFacts } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { summarizeMonth } from "@/lib/reporting";
import { currentShopSeason, type ShopSeason, shopSeasonLabel, shopSeasonOf } from "@/lib/season";
import type { ShopSwitchFlags } from "@/lib/shop-features";
import { summarizeShopYear } from "@/lib/shop-year";
import { shopPath } from "@/lib/staff-notices";
import { sameMomentYearBefore, shopDaysBounds } from "@/lib/zoned";
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
 *
 * **The year is the shop's season** (issue #2657): every read here, the year
 * switch and the header's range run from the shop's season start, so a May
 * shop reads "2026–27" from May 1 and a January shop reads "2026" as before.
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
  shop: ShopSwitchFlags & {
    id: string;
    slug: string;
    timezone: string;
    currency: string;
    seasonStartMonth: number;
    seasonStartDay: number;
  };
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
  const seasonStart = { month: shop.seasonStartMonth, day: shop.seasonStartDay };
  const thisYear = currentShopSeason(now, tz, seasonStart).year;
  const firstTrip = await earliestReportedTripStart(db, shop.id);
  const firstYear = firstTrip
    ? Math.min(currentShopSeason(firstTrip, tz, seasonStart).year, thisYear)
    : thisYear;
  const asked = requestedYear && /^\d{4}$/.test(requestedYear) ? Number(requestedYear) : thisYear;
  const yearNumber = asked >= firstYear && asked <= thisYear ? asked : thisYear;
  const isThisYear = yearNumber === thisYear;
  const season = shopSeasonOf(yearNumber, seasonStart);
  const lastSeason = shopSeasonOf(yearNumber - 1, seasonStart);
  // Last year "by this date" while this year runs; a past year against the
  // whole year before it.
  const lastYearNow = isThisYear ? sameMomentYearBefore(now, tz) : now;
  const window = (of: ShopSeason, until?: Date) => {
    const { from, to } = shopDaysBounds(of.startsOn, of.endsOn, tz);
    return { startUtc: from, endUtc: until && until < to ? until : to, timeZone: tz };
  };
  const hasLastYear = yearNumber - 1 >= firstYear;
  const soFar = window(season, now);
  const [yearInput, toDate, lastYearInput, weather, lastWeather, certified, counter] =
    await Promise.all([
      getShopYear(db, shop.id, { timeZone: tz, ...season, now }),
      getYearToDate(db, shop.id, { timeZone: tz, currency, ...season, now }),
      hasLastYear
        ? getShopYear(db, shop.id, { timeZone: tz, ...lastSeason, now: lastYearNow })
        : null,
      weatherCallsInWindow(db, shop.id, soFar),
      hasLastYear ? weatherCallsInWindow(db, shop.id, window(lastSeason, lastYearNow)) : null,
      certifiedHere(db, shop.id, window(season)),
      counterTaxIncluded(db, shop.id, soFar.startUtc, soFar.endUtc),
    ]);
  const year = summarizeShopYear(yearInput);
  const lastYear = lastYearInput ? summarizeShopYear(lastYearInput) : null;
  const lastYearLine = (value: number) =>
    lastYear?.hasActivity
      ? t(isThisYear ? "reports.year.lastYearToDate" : "reports.year.lastYearWhole", {
          value,
          year: shopSeasonLabel(lastSeason),
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
    <StaffPage width="full">
      <ShopPageHeader
        title={t("shared.shopSections.money")}
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
      <StaffSectionTabs section="money" current="reports" roles={roles} shop={shop} t={t} />
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
              label: shopSeasonLabel(shopSeasonOf(option, seasonStart)),
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
          counterTaxIncludedCents: counter,
          csvHref: `${shopPath(shopSlug, "reports", "download")}?year=${year.year}`,
        }}
        locale={locale}
        shopSlug={shopSlug}
        t={t}
      />
    </StaffPage>
  );
}
