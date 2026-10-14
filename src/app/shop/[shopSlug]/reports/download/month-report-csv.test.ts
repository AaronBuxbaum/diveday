import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { MONTH_REPORT_CSV_HEADER, monthReportCsv } from "./month-report-csv";

/**
 * The month's CSV is one table a spreadsheet opens as it comes (third UX
 * review, item 34): one header row, one fact per row. The money by line keeps
 * the page's words (issue #2305).
 */
describe("monthReportCsv", () => {
  const money = (cents: number) => `$${cents / 100}`;
  const t = staffTranslator("en-US");

  it("writes one header and one fact per row", () => {
    const csv = monthReportCsv(
      {
        summary: [
          ["Net revenue", "$5,839"],
          ["Bookings", 42],
        ],
        lines: [
          { line: "funDives", cents: 18_000 },
          { line: "imported", cents: 40_000 },
        ],
        trips: [
          {
            title: "Two-Tank Reef",
            startsAt: new Date("2026-10-08T12:30:00Z"),
            seatsBooked: 9,
            capacity: 12,
            fill: "75%",
            crewAssigned: 2,
            waiversSigned: 8,
          },
        ],
      },
      t,
      money,
    );
    const rows = csv.trimEnd().split("\r\n");
    expect(rows[0]).toBe(MONTH_REPORT_CSV_HEADER.join(","));
    expect(rows.slice(1)).toEqual([
      'Summary,,,Net revenue,"$5,839"',
      "Summary,,,Bookings,42",
      '"Money in, by line",Fun dives and trips,,Amount,$180',
      '"Money in, by line",Unverified imported history,,Amount,$400',
      "Trips,Two-Tank Reef,2026-10-08T12:30:00.000Z,Seats booked,9",
      "Trips,Two-Tank Reef,2026-10-08T12:30:00.000Z,Capacity,12",
      "Trips,Two-Tank Reef,2026-10-08T12:30:00.000Z,Fill,75%",
      "Trips,Two-Tank Reef,2026-10-08T12:30:00.000Z,Crew assigned,2",
      "Trips,Two-Tank Reef,2026-10-08T12:30:00.000Z,Waivers signed,8",
    ]);
  });

  it("writes the header alone for a month with nothing in it", () => {
    expect(monthReportCsv({ summary: [], lines: [], trips: [] }, t, money)).toBe(
      `${MONTH_REPORT_CSV_HEADER.join(",")}\r\n`,
    );
  });
});
