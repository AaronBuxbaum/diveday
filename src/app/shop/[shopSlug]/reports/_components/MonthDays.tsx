import type { AppDb } from "@/db/client";
import { getShopYear } from "@/features/reporting";
import { type ShopYearSummary, summarizeShopYear } from "@/features/shop-year";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { isoDate, type MonthRef } from "@/lib/calendar";
import { StripLegend } from "./StripLegend";
import { stripCopy } from "./YearReport";
import { YearStrip } from "./YearStrip";

export async function readMonthDays(
  db: AppDb,
  shopId: string,
  timeZone: string,
  month: MonthRef,
  now: Date,
) {
  const days = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  return summarizeShopYear(
    await getShopYear(db, shopId, {
      timeZone,
      startsOn: isoDate(month.year, month.month, 1),
      endsOn: isoDate(month.year, month.month, days),
      now,
    }),
  );
}

/**
 * **The month as a strip of days, above its figures** (issue #2664): the
 * year's strip at the month's zoom, one row of 28 to 31 squares on the same
 * fills, read through the same `getShopYear` and `summarizeShopYear` over the
 * month's window. Only the strip: the figures and the ledger below it keep
 * their own shape (Aaron, 2026-10-17: one visual change, no further folding).
 *
 * Empty months still show their whole calendar; blank context changes no figures.
 */
export function MonthDays({
  summary,
  month,
  locale,
  t,
}: {
  summary: ShopYearSummary;
  month: MonthRef;
  locale: string;
  t: StaffTranslator;
}) {
  const days = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  return (
    <section aria-label={t("reports.monthStripLabel")} className="mb-8">
      <YearStrip
        cells={summary.strip}
        row={{ days }}
        copy={stripCopy(t, locale, summary.firstDay)}
      />
      <StripLegend t={t} />
    </section>
  );
}
