import type { MonthMoneyDetail } from "@/db/report-lines";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { buildCsv, type CsvValue } from "@/lib/export";
import { BY_LINE_KEYS } from "../_components/MonthMoneyDetail";

/**
 * **The month's report as one tidy table** (third UX review, item 34).
 *
 * The file was three tables in one CSV, a summary, the money by line and the
 * trips, each under its own header row, which a spreadsheet opens as one sheet
 * with three headers that has to be cut apart by hand. It is now one header and
 * one fact per row: which part of the report it belongs to, what it is about
 * (a line of money, a departure, or nothing for a headline figure), the
 * departure's date where there is one, the measure, and its value. A
 * spreadsheet filters or pivots it as it comes.
 *
 * The money by line is the page's own rows in the page's words, off the one
 * query that feeds both (issue #2305), so the screen and the file cannot
 * disagree.
 */
export const MONTH_REPORT_CSV_HEADER = ["Section", "Item", "Date", "Measure", "Value"];

export type MonthReportCsvInput = {
  /** The headline figures, already formatted, in the order the page shows them. */
  summary: [measure: string, value: CsvValue][];
  lines: MonthMoneyDetail["lines"];
  trips: {
    title: string;
    startsAt: Date;
    seatsBooked: number;
    capacity: number;
    fill: string;
    crewAssigned: number;
    waiversSigned: number;
  }[];
};

export function monthReportCsv(
  input: MonthReportCsvInput,
  t: StaffTranslator,
  money: (cents: number) => string,
): string {
  const rows: CsvValue[][] = [
    ...input.summary.map(([measure, value]) => ["Summary", "", "", measure, value]),
    ...input.lines.map(({ line, cents }) => [
      t("reports.byLine.heading"),
      t(BY_LINE_KEYS[line]),
      "",
      "Amount",
      money(cents),
    ]),
    ...input.trips.flatMap((trip) =>
      (
        [
          ["Seats booked", trip.seatsBooked],
          ["Capacity", trip.capacity],
          ["Fill", trip.fill],
          ["Crew assigned", trip.crewAssigned],
          ["Waivers signed", trip.waiversSigned],
        ] as const
      ).map(([measure, value]) => ["Trips", trip.title, trip.startsAt, measure, value]),
    ),
  ];
  return buildCsv(MONTH_REPORT_CSV_HEADER, rows);
}
