import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { tripHeaderDaySpan, tripHeaderPrice } from "./trip-header-price";

const t = staffTranslator("en-US");
const plain = (priceCents: number | null) => ({ priceCents, course: null });

describe("tripHeaderPrice", () => {
  it("prints a whole price without its cents", () => {
    expect(tripHeaderPrice(plain(9500), "usd", "en-US", t)).toBe("$95 per diver");
  });

  it("keeps cents that are not zero", () => {
    expect(tripHeaderPrice(plain(6250), "usd", "en-US", t)).toBe("$62.50 per diver");
  });

  it("says nothing for an unpriced departure", () => {
    expect(tripHeaderPrice(plain(null), "usd", "en-US", t)).toBeUndefined();
  });

  /** Fourth UX review, item 26: the course total the diver is charged, not the departure's $595. */
  it("quotes a course session at the course fee plus its eLearning fee", () => {
    const course = { title: "Open Water", priceCents: 49_900, eLearningPriceCents: 21_000 };
    expect(tripHeaderPrice({ priceCents: 59_500, course }, "usd", "en-US", t)).toBe(
      "$709 per diver",
    );
    // An unpriced course falls back to the departure's own price, as checkout does.
    const unpriced = { ...course, priceCents: null };
    expect(tripHeaderPrice({ priceCents: 59_500, course: unpriced }, "usd", "en-US", t)).toBe(
      "$805 per diver",
    );
  });
});

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
