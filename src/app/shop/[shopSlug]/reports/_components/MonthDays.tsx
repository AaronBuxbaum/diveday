import type { AppDb } from "@/db/client";
import { getShopYear } from "@/db/reporting";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { isoDate, type MonthRef } from "@/lib/calendar";
import { type ShopYearSummary, summarizeShopYear } from "@/lib/shop-year";
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
 * Nothing while no boat of the month has sailed, as the year says nothing
 * before its first departure.
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
  if (!summary.hasActivity) return null;
  return (
    <section aria-label={t("reports.monthStripLabel")} className="mb-8">
      {/* The strip's two ends say what its depths mean (visual review A28);
          the sentence that explained it under the strip is gone. */}
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="shrink-0">{t("reports.year.stripQuiet")}</span>
        <YearStrip
          cells={summary.strip}
          row={{ days }}
          copy={stripCopy(t, locale, summary.firstDay)}
          className="min-w-0 flex-1"
        />
        <span className="shrink-0">{t("reports.year.stripFull")}</span>
      </div>
    </section>
  );
}
