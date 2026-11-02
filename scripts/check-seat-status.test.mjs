import { describe, expect, it } from "vitest";
import { findRawCancelledClauses } from "./check-seat-status.mjs";

const lines = (source) => findRawCancelledClauses(source).map((finding) => finding.line);

describe("a hand-typed not-cancelled clause", () => {
  it("is refused on one line", () => {
    expect(lines(`where(and(eq(bookings.tripId, id), ne(bookings.status, "cancelled")))`)).toEqual([
      1,
    ]);
  });

  it("is refused when split across lines", () => {
    expect(
      lines(`
        where(
          ne(
            bookings.status,
            "cancelled",
          ),
        )
      `),
    ).toEqual([3]);
  });

  it("passes when the named predicate is used", () => {
    expect(lines("where(and(eq(bookings.tripId, id), seatNotCancelled))")).toEqual([]);
  });

  it("passes when it says why", () => {
    expect(
      lines(`
        // diveday:allow-status-clause: a different table's alias
        ne(bookings.status, "cancelled")
      `),
    ).toEqual([]);
  });

  it("leaves other statuses alone", () => {
    expect(lines(`ne(bookings.status, "no_show")`)).toEqual([]);
  });
});
