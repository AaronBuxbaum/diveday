import { describe, expect, it } from "vitest";
import type { ExportTable } from "./export";
import { withoutRehearsals } from "./rehearsal-export";

const TRIP = "11111111-1111-4111-8111-111111111111";
const REAL_TRIP = "22222222-2222-4222-8222-222222222222";
const SEAT = "33333333-3333-4333-8333-333333333333";
const REAL_SEAT = "44444444-4444-4444-8444-444444444444";

function table(file: string, header: string[], rows: unknown[][]): ExportTable {
  return { file, header, rows: rows as ExportTable["rows"], note: "" };
}

const ids = { tripIds: new Set([TRIP]), bookingIds: new Set([SEAT]) };

describe("withoutRehearsals", () => {
  it("drops the rehearsal and its seats by id", () => {
    const [trips, bookings] = withoutRehearsals(
      [
        table(
          "trips.csv",
          ["id", "title"],
          [
            [TRIP, "Drill"],
            [REAL_TRIP, "Reef"],
          ],
        ),
        table(
          "bookings.csv",
          ["id", "trip_id"],
          [
            [SEAT, TRIP],
            [REAL_SEAT, REAL_TRIP],
          ],
        ),
      ],
      ids,
    );
    expect(trips.rows).toEqual([[REAL_TRIP, "Reef"]]);
    expect(bookings.rows).toEqual([[REAL_SEAT, REAL_TRIP]]);
  });

  it("drops every row of any other file that names the rehearsal or one of its seats", () => {
    const [roll, notes] = withoutRehearsals(
      [
        table(
          "booking_arrival_events.csv",
          ["id", "trip_id", "booking_id"],
          [
            ["a", TRIP, SEAT],
            ["b", REAL_TRIP, REAL_SEAT],
          ],
        ),
        table(
          "internal_notes.csv",
          ["id", "booking_id"],
          [
            ["c", SEAT],
            ["d", null],
          ],
        ),
      ],
      ids,
    );
    expect(roll.rows.map((row) => row[0])).toEqual(["b"]);
    expect(notes.rows.map((row) => row[0])).toEqual(["d"]);
  });

  it("keeps a release signed at a rehearsal, pointing at no seat", () => {
    const [waivers] = withoutRehearsals(
      [
        table(
          "waiver_records.csv",
          ["id", "booking_id"],
          [
            ["w", SEAT],
            ["x", REAL_SEAT],
          ],
        ),
      ],
      ids,
    );
    expect(waivers.rows).toEqual([
      ["w", null],
      ["x", REAL_SEAT],
    ]);
  });

  it("keeps a rehearsal's roll call and course paperwork, pointing at no departure or seat", () => {
    const [roll, forms] = withoutRehearsals(
      [
        table(
          "roll_call_events.csv",
          ["id", "trip_id", "booking_id", "person_name", "status"],
          [
            ["r", TRIP, SEAT, "Test Diver", "boarded"],
            ["s", REAL_TRIP, REAL_SEAT, "Real Diver", "boarded"],
          ],
        ),
        table(
          "course_form_records.csv",
          ["id", "booking_id", "trip_id", "signed_name"],
          [
            ["f", SEAT, TRIP, "Test Diver"],
            ["g", REAL_SEAT, REAL_TRIP, "Real Diver"],
          ],
        ),
      ],
      ids,
    );
    expect(roll.rows).toEqual([
      ["r", null, null, "Test Diver", "boarded"],
      ["s", REAL_TRIP, REAL_SEAT, "Real Diver", "boarded"],
    ]);
    expect(forms.rows).toEqual([
      ["f", null, null, "Test Diver"],
      ["g", REAL_SEAT, REAL_TRIP, "Real Diver"],
    ]);
  });

  it("returns the tables untouched when the shop has no rehearsal", () => {
    const tables = [table("trips.csv", ["id"], [[REAL_TRIP]])];
    expect(withoutRehearsals(tables, { tripIds: new Set(), bookingIds: new Set() })).toBe(tables);
  });
});
