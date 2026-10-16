import type { DbExecutor } from "@/db/client";
import { queryAll } from "@/db/query-helpers";
import { getMonthMoneyDetail } from "@/db/report-lines";
import { crewCountsByTrip, getMonthlyReport } from "@/db/reporting";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type MonthRef, monthKey } from "@/lib/calendar";
import { exportDateStamp } from "@/lib/export";
import { toShopCurrency } from "@/lib/money";
import { formatPercent, formatReportMoney, summarizeMonth, tripFillRate } from "@/lib/reporting";
import { shopMonthBounds } from "@/lib/zoned";
import { monthReportCsv } from "./month-report-csv";

export type MonthFileShop = {
  id: string;
  slug: string;
  timezone: string;
  currency: string;
  defaultLocale: string;
};

/**
 * **One month's report as a file**: what the Reports CSV door downloads, and
 * the first of the month-end files the bookkeeper's email attaches (fifth
 * loop, item 35), built once so the two cannot drift.
 */
export async function monthReportFile(
  db: DbExecutor,
  shop: MonthFileShop,
  month: MonthRef,
  now: Date,
  t: StaffTranslator,
): Promise<{ fileName: string; csv: string }> {
  const currency = toShopCurrency(shop.currency);
  const { from: monthStart, to: monthEnd } = shopMonthBounds(month, shop.timezone);
  const options = { currency, timeZone: shop.timezone };
  const [input, detail] = await queryAll(db, [
    () => getMonthlyReport(db, shop.id, monthStart, monthEnd, options),
    () => getMonthMoneyDetail(db, shop.id, monthStart, monthEnd, now, options),
  ]);
  const report = summarizeMonth(input);
  const crewCounts = await crewCountsByTrip(
    db,
    shop.id,
    input.trips.map((trip) => trip.tripId),
  );
  const money = (cents: number) => formatReportMoney(cents, currency, shop.defaultLocale);
  const csv = monthReportCsv(
    {
      summary: [
        ["Net revenue", money(report.revenueCents)],
        ["Pass-through collected", money(report.passThroughCents ?? 0)],
        ["Tax collected", money(report.taxCents)],
        ["Tips", money(report.tipsCents)],
        ["Bookings", report.seatsBooked],
        ["Seats offered", report.seatsOffered],
        ["Seat fill", formatPercent(report.fillRate)],
        ["Waivers signed", report.waiverComplete],
        ["Waivers outstanding", report.waiverOutstanding],
      ],
      lines: detail.lines,
      trips: input.trips.map((trip) => ({
        title: trip.title,
        startsAt: trip.startsAt,
        seatsBooked: trip.activeBookings,
        capacity: trip.capacity,
        fill: formatPercent(tripFillRate(trip)),
        crewAssigned: crewCounts.get(trip.tripId) ?? 0,
        waiversSigned: trip.waiverComplete,
      })),
    },
    t,
    money,
  );
  return {
    fileName: `diveday-report-${shop.slug}-${monthKey(month)}-${exportDateStamp(now, shop.timezone)}.csv`,
    csv,
  };
}
