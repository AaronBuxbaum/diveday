import { describe, expect, it } from "vitest";
import { prepareContactImport as prepareContactImportOn } from "./import";

/**
 * **Seats sold in the old system are not visits** (market sheet 2026-10-22,
 * item 3; ADR 20260725-import-prior-visits, amended 2026-10-22). A sibling of
 * `import.test.ts`, which holds the rest of the importer's rules.
 */
describe("prepareContactImport — bookings after today", () => {
  // A switching shop exports Bookings "over the same wide date range", so the
  // file holds November's seats sold in the old system. Those are not visits
  // yet: filed as history they would read as dives that happened, and the
  // board would show those boats empty.
  const today = "2026-10-22";
  const seasonExport = [
    "customer_name,email,booking_date,tour_name,booking_status,total,booking_id",
    "Hana Kobayashi,hana@example.com,2026-10-21,Two-tank Molasses Reef,Completed,$165.00,FH-1",
    "Hana Kobayashi,hana@example.com,2026-10-22,Night dive Benwood,Booked,$95.00,FH-2",
    "Hana Kobayashi,hana@example.com,2026-11-14,Two-tank Molasses Reef,Booked,$165.00,FH-3",
    "Sam Reed,sam@example.com,11/02/2026,Discover Scuba,Booked,$120.00,FH-4",
    ",nobody@example.com,2026-12-01,Wreck trek,Booked,$140.00,FH-5",
  ].join("\n");

  it("files a booking dated today or earlier as a visit, and one after today as nothing", () => {
    const prepared = prepareContactImportOn(seasonExport, { today });
    const [past, sameDay, november, sam] = prepared.rows;
    expect(past.visit?.visitedOn).toBe("2026-10-21");
    // Today's boat is the shop's own day: it sails before the file is read again.
    expect(sameDay.visit?.visitedOn).toBe("2026-10-22");
    expect(november.visit).toBeNull();
    expect(sam.visit).toBeNull();
    expect(prepared.totals.withVisit).toBe(2);
  });

  it("lists every booking after today with its row, date and trip, and counts them", () => {
    const prepared = prepareContactImportOn(seasonExport, { today });
    expect(prepared.totals.bookingsAfterToday).toBe(2);
    expect(prepared.rows[2].bookingAfterToday).toEqual({
      bookedFor: "2026-11-14",
      title: "Two-tank Molasses Reef",
      sourceReference: "FH-3",
    });
    // A US-locale date reads the same way as a past visit's does.
    expect(prepared.rows[3].bookingAfterToday?.bookedFor).toBe("2026-11-02");
    expect(prepared.rows[0].bookingAfterToday).toBeNull();
    expect(prepared.rows[1].bookingAfterToday).toBeNull();
  });

  it("still brings the diver in: the seat stays behind, the person does not", () => {
    const prepared = prepareContactImportOn(seasonExport, { today });
    expect(prepared.rows[3]).toMatchObject({ fullName: "Sam Reed", action: "import" });
    expect(prepared.totals.importable).toBe(2);
  });

  it("never lists a skipped row's booking", () => {
    const prepared = prepareContactImportOn(seasonExport, { today });
    expect(prepared.rows[4].action).toBe("skip");
    expect(prepared.rows[4].bookingAfterToday).toBeNull();
  });

  it("reads today as the caller's day, not the file's or the machine's", () => {
    // The same file a day later: the Night dive has sailed, November has not.
    const tomorrow = prepareContactImportOn(seasonExport, { today: "2026-10-23" });
    expect(tomorrow.rows[1].visit?.visitedOn).toBe("2026-10-22");
    expect(tomorrow.totals.bookingsAfterToday).toBe(2);
    // A day earlier, today's boat has not sailed yet.
    const yesterday = prepareContactImportOn(seasonExport, { today: "2026-10-21" });
    expect(yesterday.rows[1].visit).toBeNull();
    expect(yesterday.rows[1].bookingAfterToday?.bookedFor).toBe("2026-10-22");
    expect(yesterday.totals.bookingsAfterToday).toBe(3);
  });
});
