import { getDb } from "@/db/client";
import { canPersonViewShopReports, crewCountsByTrip, getMonthlyReport } from "@/db/reporting";
import { getShopById } from "@/db/shops";
import { addMonths, type MonthRef, monthKey, parseMonthKey } from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import { buildCsv, exportDateStamp } from "@/lib/export";
import { toShopCurrency } from "@/lib/money";
import { formatPercent, formatReportMoney, summarizeMonth, tripFillRate } from "@/lib/reporting";
import { requireStaffSession } from "@/lib/session";
import { utcToWallTime, wallTimeToUtc } from "@/lib/zoned";

/**
 * A CSV of one month's report — "just this month's numbers" for an owner's
 * accountant, distinct from the full-shop export (the right tool for a
 * bookkeeper, the wrong one for this). Same gate as the page itself
 * (canPersonViewShopReports), re-checked against the database for the same
 * reason: revenue access has to close the instant a manager is demoted or
 * disabled, not at their next sign-in.
 *
 * Reuses buildCsv (src/lib/export.ts) rather than a second serializer, as
 * two blocks — the headline numbers, then the trip breakdown — since the two
 * are not one uniform table. `?month=` is read directly, not re-clamped to
 * the shop's own earliest month the way the page's picker is: a hand-edited
 * out-of-range month downloads an honest, empty report rather than a page
 * that needs a floor to stay usable.
 */
export async function GET(request: Request) {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonViewShopReports(db, session.user.shopId, session.user.personId))) {
    return new Response("Reports are limited to the shop's owner or manager.", { status: 403 });
  }
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return new Response("Shop not found", { status: 404 });
  const currency = toShopCurrency(shop.currency);

  const now = nowDate();
  const todayWall = utcToWallTime(now, shop.timezone);
  const requested = parseMonthKey(new URL(request.url).searchParams.get("month"));
  const current: MonthRef = requested ?? { year: todayWall.year, month: todayWall.month };
  const next = addMonths(current, 1);
  const monthStart = wallTimeToUtc(
    { year: current.year, month: current.month, day: 1, hour: 0, minute: 0 },
    shop.timezone,
  );
  const monthEnd = wallTimeToUtc(
    { year: next.year, month: next.month, day: 1, hour: 0, minute: 0 },
    shop.timezone,
  );

  const input = await getMonthlyReport(db, shop.id, monthStart, monthEnd, {
    currency,
    timeZone: shop.timezone,
  });
  const report = summarizeMonth(input);
  const crewCounts = await crewCountsByTrip(
    db,
    shop.id,
    input.trips.map((trip) => trip.tripId),
  );

  const summaryCsv = buildCsv(
    ["Metric", "This month"],
    [
      ["Net revenue", formatReportMoney(report.revenueCents, currency, shop.defaultLocale)],
      ["Tips", formatReportMoney(report.tipsCents, currency, shop.defaultLocale)],
      ["Bookings", report.seatsBooked],
      ["Seats offered", report.seatsOffered],
      ["Seat fill", formatPercent(report.fillRate)],
      ["Waivers signed", report.waiverComplete],
      ["Waivers outstanding", report.waiverOutstanding],
    ],
  );
  const tripsCsv = buildCsv(
    ["Date", "Trip", "Seats booked", "Capacity", "Fill", "Crew assigned", "Waivers signed"],
    input.trips.map((trip) => [
      trip.startsAt,
      trip.title,
      trip.activeBookings,
      trip.capacity,
      formatPercent(tripFillRate(trip)),
      crewCounts.get(trip.tripId) ?? 0,
      trip.waiverComplete,
    ]),
  );

  const fileName = `diveday-report-${shop.slug}-${monthKey(current)}-${exportDateStamp(now, shop.timezone)}.csv`;
  return new Response(`${summaryCsv}\r\n${tripsCsv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
