import { getMonthDeparturesWithEmptySeats } from "@/features/open-seats";
import { getMonthMoneyDetail } from "@/features/report-lines";
import {
  crewCountsByTrip,
  earliestImportedFinancialHistoryDate,
  earliestReportedTripStart,
  getMonthlyReport,
  pagedMonthlyReportTrips,
} from "@/features/reporting";
import type { AppDb } from "../../db/client";
import type { MonthRef } from "../../lib/calendar";

export { canPersonViewShopReports } from "@/features/reporting";

type ShopMoney = { currency: string; timeZone: string };

/**
 * The oldest instants this shop could have anything to report on: its first
 * reported departure, and its first imported payment or refund day. The
 * month report's floor is read from these before the month is chosen.
 */
export async function getReportsFloor(db: AppDb, shopId: string, currency: string) {
  const [earliestTripStart, earliestImportedFinancialDate] = await Promise.all([
    earliestReportedTripStart(db, shopId),
    earliestImportedFinancialHistoryDate(db, shopId, currency),
  ]);
  return { earliestTripStart, earliestImportedFinancialDate };
}

/**
 * The month report's question in one call, once the month is chosen: its
 * totals, one page of its departures with their crew counts, the baseline
 * window's totals, the money detail, the departures that left with empty
 * seats, and, while the month is under way, its sailed half.
 */
export async function getReportsMonth(
  db: AppDb,
  shopId: string,
  input: {
    month: MonthRef;
    start: Date;
    end: Date;
    now: Date;
    page: number;
    shopMoney: ShopMoney;
    baselineWindow: { start: Date; end: Date } | null;
    underWay: boolean;
  },
) {
  const { month, start, end, now, page, shopMoney, baselineWindow, underWay } = input;
  const [report, tripPage, baseline, moneyDetail, emptySeats, sailed] = await Promise.all([
    getMonthlyReport(db, shopId, start, end, shopMoney),
    pagedMonthlyReportTrips(db, shopId, start, end, { page }),
    baselineWindow
      ? getMonthlyReport(db, shopId, baselineWindow.start, baselineWindow.end, shopMoney)
      : Promise.resolve(null),
    getMonthMoneyDetail(db, shopId, start, end, now, shopMoney, month),
    // The departures that left with empty seats (issue #2424), on the debrief's own rule.
    getMonthDeparturesWithEmptySeats(db, shopId, { startUtc: start, endUtc: end }, now),
    underWay ? getMonthlyReport(db, shopId, start, now, shopMoney) : null,
  ]);
  // How many crew were assigned per departure on this page: the number only,
  // never a cost (issue #700), scoped to the ledger's own page of trips.
  const crewCounts = tripPage.trips.length
    ? await crewCountsByTrip(
        db,
        shopId,
        tripPage.trips.map((trip) => trip.tripId),
      )
    : new Map<string, number>();
  return { report, tripPage, baseline, moneyDetail, emptySeats, sailed, crewCounts };
}
