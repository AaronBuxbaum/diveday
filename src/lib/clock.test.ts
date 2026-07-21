import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate, nowMs } from "./clock";

/**
 * The clock is the seam the e2e harness freezes so visual baselines stay
 * stable. Its whole contract is "live by default, frozen only when explicitly
 * asked, and never in production" — so that is exactly what these assert.
 */
describe("clock", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    vi.restoreAllMocks();
  });

  it("returns the live clock when DIVEDAY_CLOCK is unset", () => {
    process.env.DIVEDAY_CLOCK = undefined;
    const before = Date.now();
    const observed = nowMs();
    const after = Date.now();
    expect(observed).toBeGreaterThanOrEqual(before);
    expect(observed).toBeLessThanOrEqual(after);
  });

  it("freezes to DIVEDAY_CLOCK when set and no real database is configured", () => {
    process.env.DIVEDAY_CLOCK = "2026-07-21T13:30:00.000Z";
    process.env.DATABASE_URL = "";
    expect(nowMs()).toBe(Date.parse("2026-07-21T13:30:00.000Z"));
    expect(nowDate().toISOString()).toBe("2026-07-21T13:30:00.000Z");
  });

  it("returns the same instant on every call while frozen", () => {
    process.env.DIVEDAY_CLOCK = "2026-07-21T13:30:00.000Z";
    process.env.DATABASE_URL = "";
    expect(nowMs()).toBe(nowDate().getTime());
    expect(nowDate().getTime()).toBe(nowDate().getTime());
  });

  it("refuses to freeze a production clock even if DIVEDAY_CLOCK is set", () => {
    process.env.DIVEDAY_CLOCK = "2000-01-01T00:00:00.000Z";
    process.env.DATABASE_URL = "postgres://real/db";
    const before = Date.now();
    expect(nowMs()).toBeGreaterThanOrEqual(before);
  });

  it("ignores an unparseable DIVEDAY_CLOCK and uses the live clock", () => {
    process.env.DIVEDAY_CLOCK = "not-a-date";
    process.env.DATABASE_URL = "";
    const before = Date.now();
    expect(nowMs()).toBeGreaterThanOrEqual(before);
  });
});
