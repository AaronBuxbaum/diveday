import { describe, expect, it } from "vitest";
import { mergeShopHistory, priorVisitStanding } from "./prior-visits";

/** Minimal stand-ins: the merge only ever reads the two accessors it is handed. */
type Booking = { id: string; startsAt: Date };
type Visit = { id: string; on: string };

function merge(bookings: Booking[], visits: Visit[], timezone = "America/New_York") {
  return mergeShopHistory(bookings, visits, {
    bookingStartsAt: (booking) => booking.startsAt,
    visitedOn: (visit) => visit.on,
    timezone,
  }).map((item) => (item.kind === "booking" ? `b:${item.entry.id}` : `v:${item.entry.id}`));
}

describe("mergeShopHistory", () => {
  it("interleaves both sources newest first", () => {
    const bookings: Booking[] = [
      { id: "recent", startsAt: new Date("2026-06-10T14:00:00Z") },
      { id: "older", startsAt: new Date("2024-01-05T14:00:00Z") },
    ];
    const visits: Visit[] = [
      { id: "mid", on: "2025-03-02" },
      { id: "oldest", on: "2019-08-19" },
    ];
    expect(merge(bookings, visits)).toEqual(["b:recent", "v:mid", "b:older", "v:oldest"]);
  });

  it("places a booking on the shop's local day, not the UTC one", () => {
    // 01:00 UTC on the 11th is still the evening of the 10th in New York. Read
    // as UTC this booking would sort above an imported visit dated the 10th;
    // read shop-locally they are the same day and the tie rule applies.
    const bookings: Booking[] = [{ id: "late", startsAt: new Date("2026-06-11T01:00:00Z") }];
    const visits: Visit[] = [{ id: "same-day", on: "2026-06-10" }];
    expect(merge(bookings, visits)).toEqual(["b:late", "v:same-day"]);

    // Same instant in a zone east of UTC really is the 11th, and then it leads
    // on date rather than on the tie rule.
    expect(merge(bookings, [{ id: "day-before", on: "2026-06-10" }], "Asia/Tokyo")).toEqual([
      "b:late",
      "v:day-before",
    ]);
  });

  it("puts the real booking first when a prior visit shares its day", () => {
    const bookings: Booking[] = [{ id: "here", startsAt: new Date("2026-06-10T14:00:00Z") }];
    const visits: Visit[] = [{ id: "imported", on: "2026-06-10" }];
    expect(merge(bookings, visits)).toEqual(["b:here", "v:imported"]);
  });

  it("handles either source being empty", () => {
    expect(merge([], [{ id: "only", on: "2020-01-01" }])).toEqual(["v:only"]);
    expect(merge([{ id: "only", startsAt: new Date("2020-01-01T12:00:00Z") }], [])).toEqual([
      "b:only",
    ]);
    expect(merge([], [])).toEqual([]);
  });
});

describe("priorVisitStanding", () => {
  it("recognizes the words an export uses for a booking that never happened", () => {
    for (const label of [
      "Cancelled",
      "canceled",
      "No-show",
      "no show",
      "Refunded",
      "VOID",
      "Declined",
    ]) {
      expect(priorVisitStanding(label)).toBe("did_not_happen");
    }
  });

  it("treats anything it doesn't recognize as a visit that stands", () => {
    // Under-matching is the safe direction: an unrecognized status still shows
    // its own label, while over-matching would quietly strike through a visit
    // that did happen.
    for (const label of ["Completed", "Checked in", "Attended", "Paid", "", null, undefined]) {
      expect(priorVisitStanding(label)).toBe("recorded");
    }
  });
});
