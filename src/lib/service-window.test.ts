import { describe, expect, it } from "vitest";
import {
  boatServiceWindow,
  firstHeldDayInWindow,
  HULL_NOT_IN_SHOP,
  hullHeldSpans,
  parseServiceWindow,
  SERVICE_WINDOW_REASON_MAX,
  serviceWindowCovers,
  serviceWindowCoversInstant,
  serviceWindowFrom,
} from "./service-window";

/**
 * Loop 5, row 5: a boat in the yard and a site closed this month are each one
 * shop-local calendar window, both ends inclusive, with the shop's reason.
 */
describe("parseServiceWindow", () => {
  it("reads two blank dates as no window, whatever the reason box says", () => {
    expect(parseServiceWindow({ from: "", until: "", reason: "" })).toEqual({
      ok: true,
      window: null,
    });
    expect(parseServiceWindow({ from: "", until: "", reason: "Hull repaint" })).toEqual({
      ok: true,
      window: null,
    });
  });

  it("reads a window with its reason, trimmed", () => {
    expect(
      parseServiceWindow({ from: "2026-11-10", until: "2026-11-20", reason: "  Hull repaint " }),
    ).toEqual({
      ok: true,
      window: { from: "2026-11-10", until: "2026-11-20", reason: "Hull repaint" },
    });
  });

  it("takes a one-day window and a window with no reason", () => {
    expect(parseServiceWindow({ from: "2026-11-10", until: "2026-11-10", reason: "" })).toEqual({
      ok: true,
      window: { from: "2026-11-10", until: "2026-11-10", reason: null },
    });
  });

  it("refuses one end alone, an end before its start, and a day that does not exist", () => {
    expect(parseServiceWindow({ from: "2026-11-10", until: "", reason: "" })).toEqual({
      ok: false,
      reason: "one_end",
    });
    expect(parseServiceWindow({ from: "", until: "2026-11-10", reason: "" })).toEqual({
      ok: false,
      reason: "one_end",
    });
    expect(parseServiceWindow({ from: "2026-11-20", until: "2026-11-10", reason: "" })).toEqual({
      ok: false,
      reason: "out_of_order",
    });
    expect(parseServiceWindow({ from: "2026-02-31", until: "2026-03-02", reason: "" })).toEqual({
      ok: false,
      reason: "invalid_date",
    });
  });

  it("refuses a reason longer than the column takes", () => {
    expect(
      parseServiceWindow({
        from: "2026-11-10",
        until: "2026-11-20",
        reason: "x".repeat(SERVICE_WINDOW_REASON_MAX + 1),
      }),
    ).toEqual({ ok: false, reason: "reason_too_long" });
  });
});

describe("serviceWindowCovers and firstHeldDayInWindow", () => {
  const yard = { from: "2026-11-10", until: "2026-11-20", reason: null };

  it("covers both ends and every day between, and nothing outside", () => {
    expect(serviceWindowCovers(yard, "2026-11-09")).toBe(false);
    expect(serviceWindowCovers(yard, "2026-11-10")).toBe(true);
    expect(serviceWindowCovers(yard, "2026-11-15")).toBe(true);
    expect(serviceWindowCovers(yard, "2026-11-20")).toBe(true);
    expect(serviceWindowCovers(yard, "2026-11-21")).toBe(false);
    expect(serviceWindowCovers(null, "2026-11-15")).toBe(false);
  });

  it("names the first yard day any span holds, and null when every span misses", () => {
    const span = (from: string, until: string) => ({ from, until });
    expect(firstHeldDayInWindow(yard, [span("2026-11-08", "2026-11-09")])).toBeNull();
    expect(firstHeldDayInWindow(yard, [span("2026-11-09", "2026-11-10")])).toBe("2026-11-10");
    // A span wider than the window on both sides still lands in it.
    expect(firstHeldDayInWindow(yard, [span("2026-11-01", "2026-11-30")])).toBe("2026-11-10");
    expect(
      firstHeldDayInWindow(yard, [
        span("2026-11-18", "2026-11-18"),
        span("2026-11-12", "2026-11-13"),
      ]),
    ).toBe("2026-11-12");
    expect(firstHeldDayInWindow(yard, [span("2026-11-21", "2026-11-21")])).toBeNull();
    expect(firstHeldDayInWindow(null, [span("2026-11-15", "2026-11-15")])).toBeNull();
  });
});

describe("serviceWindowFrom", () => {
  it("reads a row's three columns, and null for a row with none", () => {
    expect(serviceWindowFrom("2026-11-10", "2026-11-20", "Hull repaint")).toEqual({
      from: "2026-11-10",
      until: "2026-11-20",
      reason: "Hull repaint",
    });
    expect(serviceWindowFrom(null, null, null)).toBeNull();
    // Half a window is no window (the check constraint forbids it anyway).
    expect(serviceWindowFrom("2026-11-10", null, null)).toBeNull();
  });
});

describe("boatServiceWindow", () => {
  it("reads a boat's yard columns, and nothing for no boat", () => {
    expect(
      boatServiceWindow({
        outOfServiceFrom: "2026-11-10",
        outOfServiceUntil: "2026-11-20",
        outOfServiceReason: null,
      }),
    ).toEqual({ from: "2026-11-10", until: "2026-11-20", reason: null });
    expect(boatServiceWindow(null)).toBeNull();
    expect(
      boatServiceWindow({
        outOfServiceFrom: null,
        outOfServiceUntil: null,
        outOfServiceReason: null,
      }),
    ).toBeNull();
  });
});

describe("serviceWindowCoversInstant", () => {
  const window = { from: "2026-11-10", until: "2026-11-20", reason: null };

  it("reads the shop's own day at that instant, both ends included", () => {
    const ny = "America/New_York";
    // 03:00 UTC on the 10th is still the 9th in New York.
    expect(serviceWindowCoversInstant(window, new Date("2026-11-10T03:00:00Z"), ny)).toBe(false);
    expect(serviceWindowCoversInstant(window, new Date("2026-11-10T15:00:00Z"), ny)).toBe(true);
    expect(serviceWindowCoversInstant(window, new Date("2026-11-21T03:00:00Z"), ny)).toBe(true);
    expect(serviceWindowCoversInstant(window, new Date("2026-11-21T15:00:00Z"), ny)).toBe(false);
    expect(serviceWindowCoversInstant(null, new Date("2026-11-15T15:00:00Z"), ny)).toBe(false);
  });
});

/**
 * Issue #3994, Aaron's decision of 2026-11-06: held is nights aboard. A leg
 * holds the hull every shop-local day from its start through its end.
 */
describe("hullHeldSpans", () => {
  const ny = "America/New_York";
  const leg = (startsAt: string, endsAt: string) => ({
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
  });

  const held = (legs: ReturnType<typeof leg>[]) => hullHeldSpans(legs, ny);

  it("holds one day for a morning boat", () => {
    expect(held([leg("2031-01-10T13:00:00Z", "2031-01-10T17:00:00Z")])).toEqual([
      { from: "2031-01-10", until: "2031-01-10" },
    ]);
  });

  it("holds every day of a Friday-to-Sunday liveaboard, the nights between included", () => {
    expect(held([leg("2031-01-10T13:00:00Z", "2031-01-12T22:00:00Z")])).toEqual([
      { from: "2031-01-10", until: "2031-01-12" },
    ]);
  });

  it("holds the morning a night dive comes back, read in the shop's zone", () => {
    // 20:00 Saturday to 02:00 Sunday in New York.
    expect(held([leg("2031-01-12T01:00:00Z", "2031-01-12T07:00:00Z")])).toEqual([
      { from: "2031-01-11", until: "2031-01-12" },
    ]);
    // 19:00 to 23:00 on the 11th is 00:00Z to 04:00Z on the 12th: one day.
    expect(held([leg("2031-01-12T00:00:00Z", "2031-01-12T04:00:00Z")])).toEqual([
      { from: "2031-01-11", until: "2031-01-11" },
    ]);
  });

  it("does not hold the day a dive ties up at exactly midnight", () => {
    // 20:00 Saturday to 00:00 Sunday in New York: the hull is free on Sunday.
    expect(held([leg("2031-01-12T01:00:00Z", "2031-01-12T05:00:00Z")])).toEqual([
      { from: "2031-01-11", until: "2031-01-11" },
    ]);
  });

  it("holds only a course's meeting days, not the week between them", () => {
    const course = held([
      leg("2031-01-11T13:00:00Z", "2031-01-11T17:00:00Z"),
      leg("2031-01-18T13:00:00Z", "2031-01-18T17:00:00Z"),
    ]);
    expect(
      firstHeldDayInWindow({ from: "2031-01-12", until: "2031-01-17", reason: null }, course),
    ).toBeNull();
  });

  it("holds the start day of a leg whose end is before its start, and nothing for no leg", () => {
    expect(held([leg("2031-01-10T13:00:00Z", "2031-01-09T13:00:00Z")])).toEqual([
      { from: "2031-01-10", until: "2031-01-10" },
    ]);
    expect(held([])).toEqual([]);
  });

  it("answers a corrupt century-long row without walking it day by day", () => {
    const spans = held([leg("2031-01-10T13:00:00Z", "2131-01-10T13:00:00Z")]);
    expect(
      firstHeldDayInWindow({ from: "2090-06-01", until: "2090-06-02", reason: null }, spans),
    ).toBe("2090-06-01");
  });
});

describe("HULL_NOT_IN_SHOP", () => {
  it("covers every day a departure could hold", () => {
    expect(serviceWindowCovers(HULL_NOT_IN_SHOP, "2031-01-10")).toBe(true);
    expect(serviceWindowCovers(HULL_NOT_IN_SHOP, "1970-01-01")).toBe(true);
    expect(serviceWindowCovers(HULL_NOT_IN_SHOP, "2999-12-31")).toBe(true);
  });
});
