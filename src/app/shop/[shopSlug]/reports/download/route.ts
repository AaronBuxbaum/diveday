import { getDb } from "@/db/client";
import { getMonthMoneyDetail } from "@/db/report-lines";
import {
  canPersonViewShopReports,
  crewCountsByTrip,
  getMonthlyReport,
  getYearMonthInputs,
} from "@/db/reporting";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { type MonthRef, monthKey, parseMonthKey } from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import { exportDateStamp } from "@/lib/export";
import { toShopCurrency } from "@/lib/money";
import { formatPercent, formatReportMoney, summarizeMonth, tripFillRate } from "@/lib/reporting";
import { requireStaffSession } from "@/lib/session";
import { shopMonthBounds, utcToWallTime } from "@/lib/zoned";
import { monthReportCsv } from "./month-report-csv";
import { yearReportCsv } from "./year-report-csv";

/**
 * A CSV of one month's report — "just this month's numbers" for an owner's
 * accountant, distinct from the full-shop export (the right tool for a
 * bookkeeper, the wrong one for this). Same gate as the page itself
 * (canPersonViewShopReports), re-checked against the database for the same
 * reason: revenue access has to close the instant a manager is demoted or
 * disabled, not at their next sign-in.
 *
 * One tidy table (`monthReportCsv`): the headline numbers, the money by line
 * (the page's own query, issue #2305) and the trip breakdown, one fact per
 * row under one header, through buildCsv (src/lib/export.ts) rather than a
 * second serializer. `?month=` is read directly, not re-clamped to
 * the shop's own earliest month the way the page's picker is: a hand-edited
 * out-of-range month downloads an honest, empty report rather than a page
 * that needs a floor to stay usable. `?year=` cuts the year instead, as
 * twelve month rows (`yearReportCsv`).
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
  const search = new URL(request.url).searchParams;
  const yearParam = search.get("year");
  if (yearParam !== null) {
    // The year as twelve month rows (fourth UX review, item 25). Parsed, never
    // trusted: four digits, no later than this year.
    const year = /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;
    if (year === null || year > todayWall.year) {
      return new Response("Expected year=YYYY", { status: 400 });
    }
    const months = await getYearMonthInputs(db, shop.id, {
      timeZone: shop.timezone,
      currency,
      year,
      now,
    });
    const money = (cents: number) => formatReportMoney(cents, currency, shop.defaultLocale);
    const csv = yearReportCsv(
      months.map(({ month, input }) => ({ month, report: summarizeMonth(input) })),
      money,
    );
    return csvResponse(
      csv,
      `diveday-report-${shop.slug}-${year}-${exportDateStamp(now, shop.timezone)}.csv`,
    );
  }
  const requested = parseMonthKey(search.get("month"));
  const current: MonthRef = requested ?? { year: todayWall.year, month: todayWall.month };
  const { from: monthStart, to: monthEnd } = shopMonthBounds(current, shop.timezone);

  const input = await getMonthlyReport(db, shop.id, monthStart, monthEnd, {
    currency,
    timeZone: shop.timezone,
  });
  const report = summarizeMonth(input);
  const detail = await getMonthMoneyDetail(db, shop.id, monthStart, monthEnd, now, {
    currency,
    timeZone: shop.timezone,
  });
  const t = staffTranslator(await requestLocale(shop.defaultLocale));
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

  return csvResponse(
    csv,
    `diveday-report-${shop.slug}-${monthKey(current)}-${exportDateStamp(now, shop.timezone)}.csv`,
  );
}

function csvResponse(csv: string, fileName: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
