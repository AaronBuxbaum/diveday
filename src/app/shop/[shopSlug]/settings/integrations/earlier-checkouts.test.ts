import { describe, expect, it } from "vitest";
import { backfillSince } from "./earlier-checkouts";

describe("backfillSince", () => {
  it("reads the day as the start of that day in the shop's own zone", () => {
    expect(backfillSince("2026-03-01", "America/New_York")?.toISOString()).toBe(
      "2026-03-01T05:00:00.000Z",
    );
    expect(backfillSince("2026-03-01", "Pacific/Auckland")?.toISOString()).toBe(
      "2026-02-28T11:00:00.000Z",
    );
  });

  it("refuses what is not a real calendar day", () => {
    for (const day of ["2026-02-31", "2026-13-01", "2026-3-1", "yesterday", "", null, 42]) {
      expect(backfillSince(day, "America/New_York")).toBeNull();
    }
  });
});
