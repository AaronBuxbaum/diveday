import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { tripHeaderDaySpan } from "./trip-header-price";

const t = staffTranslator("en-US");
describe("tripHeaderDaySpan", () => {
  const day = (iso: string) => ({ startsAt: new Date(iso) });

  it("names a three-day course's span as the public page does", () => {
    const days = [
      day("2026-10-23T12:00:00Z"),
      day("2026-10-24T12:00:00Z"),
      day("2026-10-25T12:00:00Z"),
    ];
    // Intl may space the dates with no-break spaces; the words are what is pinned.
    expect(tripHeaderDaySpan(days, "en-US", "America/New_York", t)?.replace(/\s/gu, " ")).toBe(
      "3 days · Fri, Oct 23 – Sun, Oct 25",
    );
  });

  it("leaves a one-day departure to its date and hours", () => {
    expect(tripHeaderDaySpan([day("2026-10-23T12:00:00Z")], "en-US", "UTC", t)).toBeUndefined();
    expect(tripHeaderDaySpan([], "en-US", "UTC", t)).toBeUndefined();
  });
});
