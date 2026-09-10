import { describe, expect, it } from "vitest";
import { cardClearsDeparture, chooseShelfGreeting } from "./shelf-greeting";

/**
 * The two decisions the storefront makes about a diver whose phone carries
 * their shelf. Both are pure, and both are here rather than inside the page
 * because a greeting that counts wrong and a sentence that clears a card it
 * should not are the two ways this feature can be quietly wrong.
 */

const SHOP_ZONE = "America/New_York";

describe("which greeting a returning diver gets", () => {
  it("counts the next visit, not the last one", () => {
    expect(
      chooseShelfGreeting({
        diveCount: 11,
        nextStartsAt: new Date("2026-09-12T11:00:00Z"),
        now: new Date("2026-09-10T14:00:00Z"),
        timeZone: SHOP_ZONE,
      }),
    ).toEqual({ kind: "upcoming", ordinal: 12 });
  });

  it("says tonight when the seat leaves today in the shop's own day", () => {
    expect(
      chooseShelfGreeting({
        // 7:00 AM in New York on the 10th.
        diveCount: 11,
        nextStartsAt: new Date("2026-09-10T11:00:00Z"),
        now: new Date("2026-09-10T13:00:00Z"),
        timeZone: SHOP_ZONE,
      }),
    ).toEqual({ kind: "tonight", ordinal: 12 });
  });

  /**
   * The whole reason the zone is a required parameter. 03:00Z on the 11th is
   * still the evening of the 10th in New York, so a shop reading its own day
   * calls this today — and a server reading UTC would call it tomorrow and put
   * the wrong sentence on a diver's phone.
   */
  it("reads the day in the shop's zone, never the server's", () => {
    const now = new Date("2026-09-11T01:00:00Z");
    const nextStartsAt = new Date("2026-09-11T03:00:00Z");
    expect(chooseShelfGreeting({ diveCount: 3, nextStartsAt, now, timeZone: SHOP_ZONE })).toEqual({
      kind: "tonight",
      ordinal: 4,
    });
    expect(chooseShelfGreeting({ diveCount: 3, nextStartsAt, now, timeZone: "UTC" })).toEqual({
      kind: "tonight",
      ordinal: 4,
    });
    // …and a zone where the two instants fall on different days says so.
    expect(
      chooseShelfGreeting({
        diveCount: 3,
        nextStartsAt: new Date("2026-09-11T13:00:00Z"),
        now,
        timeZone: SHOP_ZONE,
      }),
    ).toEqual({ kind: "upcoming", ordinal: 4 });
  });

  it("greets a diver with nothing booked without a number", () => {
    expect(
      chooseShelfGreeting({
        diveCount: 6,
        nextStartsAt: null,
        now: new Date("2026-09-10T14:00:00Z"),
        timeZone: SHOP_ZONE,
      }),
    ).toEqual({ kind: "cold" });
  });

  it("puts a diver who has never been out on their first", () => {
    expect(
      chooseShelfGreeting({
        diveCount: 0,
        nextStartsAt: new Date("2026-09-12T11:00:00Z"),
        now: new Date("2026-09-10T14:00:00Z"),
        timeZone: SHOP_ZONE,
      }),
    ).toEqual({ kind: "upcoming", ordinal: 1 });
  });
});

describe("why an Advanced-only departure is open to this reader", () => {
  it("clears a demand the held card meets", () => {
    expect(cardClearsDeparture("advanced_open_water", "advanced_open_water")).toBe(true);
    expect(cardClearsDeparture("rescue", "advanced_open_water")).toBe(true);
  });

  it("says nothing when the card does not reach the demand", () => {
    expect(cardClearsDeparture("open_water", "advanced_open_water")).toBe(false);
    expect(cardClearsDeparture("advanced_open_water", "divemaster")).toBe(false);
  });

  /**
   * The silence that matters most: a board asking for Open Water is every
   * shop's ordinary board, and a sentence on all fifteen rows saying the reader
   * is allowed on them is noise rather than news.
   */
  it("says nothing about a demand at the entry rung", () => {
    expect(cardClearsDeparture("divemaster", "open_water")).toBe(false);
    expect(cardClearsDeparture("open_water", "open_water")).toBe(false);
  });

  it("says nothing when there is no card, or no demand", () => {
    expect(cardClearsDeparture(null, "advanced_open_water")).toBe(false);
    expect(cardClearsDeparture("rescue", null)).toBe(false);
    expect(cardClearsDeparture("rescue", undefined)).toBe(false);
  });
});
