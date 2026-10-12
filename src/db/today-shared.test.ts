import { describe, expect, it } from "vitest";
import { formatTime } from "@/lib/format";
import { at, NO_SUPERVISION, shopDay } from "./today-shared";

describe("today-shared", () => {
  it("names the shop's own day, not UTC's", () => {
    // 02:00 UTC on the 22nd is still the evening of the 21st in Key Largo.
    expect(shopDay(new Date("2026-07-22T02:00:00Z"), "America/New_York")).toBe("2026-07-21");
    expect(shopDay(new Date("2026-07-22T02:00:00Z"), "UTC")).toBe("2026-07-22");
  });

  it("words a departure's time on the shop's clock", () => {
    const startsAt = new Date("2026-07-21T12:00:00Z");
    expect(at(startsAt, "America/New_York", "en-US")).toBe(
      formatTime(startsAt, "en-US", "America/New_York"),
    );
  });

  it("reads an unrostered departure as nobody in the water and nobody lapsed", () => {
    expect(NO_SUPERVISION).toEqual({
      instructorCount: 0,
      assistantCount: 0,
      roster: { instructorCount: 0, assistantCount: 0 },
      lapsed: [],
    });
  });
});
