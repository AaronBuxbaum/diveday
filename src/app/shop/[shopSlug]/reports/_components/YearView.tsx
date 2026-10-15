import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import type { DbExecutor } from "@/db/client";
import { getShopYear, getYearToDate } from "@/db/reporting";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { Role } from "@/lib/authz";
import { formatTimeZoneName, monthNames } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { summarizeMonth } from "@/lib/reporting";
import { summarizeShopYear } from "@/lib/shop-year";
import { shopPath } from "@/lib/staff-notices";
import { utcToWallTime } from "@/lib/zoned";
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
 */
export async function YearView({
  db,
  shop,
  shopSlug,
  roles,
  locale,
  now,
  t,
}: {
  db: DbExecutor;
  shop: { id: string; timezone: string; currency: string };
  shopSlug: string;
  roles: readonly Role[];
  locale: string;
  now: Date;
  t: StaffTranslator;
}) {
  const tz = shop.timezone;
  const currency = toShopCurrency(shop.currency);
  const yearNumber = utcToWallTime(now, tz).year;
  const [yearInput, toDate] = await Promise.all([
    getShopYear(db, shop.id, { timeZone: tz, now }),
    getYearToDate(db, shop.id, { timeZone: tz, currency, year: yearNumber, now }),
  ]);
  const year = summarizeShopYear(yearInput);
  const zone = formatTimeZoneName(locale, tz, now);
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        title={t("shared.shopSections.money")}
        description={
          year.sinceMonth
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
              href={shopPath(shopSlug, "reports", "card")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("reports.year.printCard")}
            </a>
          ) : undefined
        }
      />
      <StaffSectionTabs shopSlug={shopSlug} section="money" current="reports" roles={roles} t={t} />
      <ReportRangeTabs shopSlug={shopSlug} range="year" t={t} className="mb-8" />
      <YearReport
        year={year}
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
