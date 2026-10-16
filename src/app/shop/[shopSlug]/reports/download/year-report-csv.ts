import { type MonthRef, monthKey } from "@/lib/calendar";
import { buildCsv } from "@/lib/export";
import { formatPercent, type MonthlyReport } from "@/lib/reporting";

const HEADER = [
  "Month",
  "Net revenue",
  "Tax collected",
  "Tips",
  "Bookings",
  "Seats offered",
  "Seat fill",
];

/**
 * **The year as twelve month rows** (fourth UX review, item 25): the tax-year
 * total an owner used to build by paging ten months and adding. One row per
 * month begun, each over the departures that left before the file was cut,
 * then a Total row that adds the money and the seats and recomputes the fill
 * from them (an average of twelve percentages is not a fill rate).
 */
export function yearReportCsv(
  months: readonly { month: MonthRef; report: MonthlyReport }[],
  money: (cents: number) => string,
): string {
  const sum = (pick: (report: MonthlyReport) => number) =>
    months.reduce((total, { report }) => total + pick(report), 0);
  const booked = sum((report) => report.seatsBooked);
  const offered = sum((report) => report.seatsOffered);
  return buildCsv(HEADER, [
    ...months.map(({ month, report }) => [
      monthKey(month),
      money(report.revenueCents),
      money(report.taxCents),
      money(report.tipsCents),
      report.seatsBooked,
      report.seatsOffered,
      formatPercent(report.fillRate),
    ]),
    [
      "Total",
      money(sum((report) => report.revenueCents)),
      money(sum((report) => report.taxCents)),
      money(sum((report) => report.tipsCents)),
      booked,
      offered,
      formatPercent(offered > 0 ? booked / offered : null),
    ],
  ]);
}
