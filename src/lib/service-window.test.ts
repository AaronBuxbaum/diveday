import { describe, expect, it } from "vitest";
import {
  boatServiceWindow,
  parseServiceWindow,
  SERVICE_WINDOW_REASON_MAX,
  serviceWindowCovers,
  serviceWindowCoversInstant,
  serviceWindowFrom,
  serviceWindowTouches,
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

describe("serviceWindowCovers and serviceWindowTouches", () => {
  const yard = { from: "2026-11-10", until: "2026-11-20", reason: null };

  it("covers both ends and every day between, and nothing outside", () => {
    expect(serviceWindowCovers(yard, "2026-11-09")).toBe(false);
    expect(serviceWindowCovers(yard, "2026-11-10")).toBe(true);
    expect(serviceWindowCovers(yard, "2026-11-15")).toBe(true);
    expect(serviceWindowCovers(yard, "2026-11-20")).toBe(true);
    expect(serviceWindowCovers(yard, "2026-11-21")).toBe(false);
    expect(serviceWindowCovers(null, "2026-11-15")).toBe(false);
  });

  it("touches a multi-day run when any one of its days falls inside", () => {
    expect(serviceWindowTouches(yard, ["2026-11-08", "2026-11-09"])).toBe(false);
    expect(serviceWindowTouches(yard, ["2026-11-09", "2026-11-10"])).toBe(true);
    expect(serviceWindowTouches(yard, ["2026-11-21"])).toBe(false);
    expect(serviceWindowTouches(null, ["2026-11-15"])).toBe(false);
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
