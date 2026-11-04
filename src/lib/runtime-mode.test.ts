import { describe, expect, it } from "vitest";
import { runtimeMode } from "./runtime-mode";

const CLOCK = "2026-03-01T12:00:00.000Z";
const REAL = "postgres://user:pass@db.invalid/diveday";

describe("runtimeMode", () => {
  it("is all off for a plain local run", () => {
    expect(runtimeMode({ NODE_ENV: "development" })).toEqual({
      realDatabase: false,
      e2eHarness: false,
      frozenClockMs: null,
      testRoutesOpen: true,
      capturePhotos: false,
      syntheticFixtures: false,
      fixtureSignIn: false,
      secureCookies: false,
      secureSessionCookies: true,
      warnMemoryRateLimit: false,
    });
  });

  it("opens the harness fields for the e2e production build with no database", () => {
    expect(runtimeMode({ NODE_ENV: "production", DIVEDAY_E2E: "1", DIVEDAY_CLOCK: CLOCK })).toEqual(
      {
        realDatabase: false,
        e2eHarness: true,
        frozenClockMs: Date.parse(CLOCK),
        testRoutesOpen: true,
        capturePhotos: true,
        syntheticFixtures: false,
        fixtureSignIn: true,
        secureCookies: false,
        secureSessionCookies: false,
        warnMemoryRateLimit: false,
      },
    );
  });

  it("reads the harness opt-in as exactly 1, and never alongside a database", () => {
    expect(runtimeMode({ DIVEDAY_E2E: "1" }).e2eHarness).toBe(true);
    expect(runtimeMode({ DIVEDAY_E2E: "true" }).e2eHarness).toBe(false);
    expect(runtimeMode({}).e2eHarness).toBe(false);
    expect(runtimeMode({ DIVEDAY_E2E: "1", DATABASE_URL: REAL }).e2eHarness).toBe(false);
  });

  it("keeps test routes shut in a production runtime without the harness opt-in", () => {
    expect(runtimeMode({ NODE_ENV: "production" }).testRoutesOpen).toBe(false);
    expect(runtimeMode({ NODE_ENV: "production", DIVEDAY_E2E: "true" }).testRoutesOpen).toBe(false);
  });

  it("is live and closed whenever DATABASE_URL is set, whatever else is (fail closed)", () => {
    for (const NODE_ENV of ["development", "test", "production", undefined]) {
      const mode = runtimeMode({
        NODE_ENV,
        DATABASE_URL: REAL,
        DIVEDAY_E2E: "1",
        DIVEDAY_DISABLE_EXTERNAL_HTTP: "1",
        DIVEDAY_CLOCK: CLOCK,
      });
      expect(mode).toEqual({
        realDatabase: true,
        e2eHarness: false,
        frozenClockMs: null,
        testRoutesOpen: false,
        capturePhotos: false,
        syntheticFixtures: false,
        fixtureSignIn: false,
        secureCookies: true,
        secureSessionCookies: true,
        warnMemoryRateLimit: NODE_ENV === "production",
      });
    }
  });

  it("treats an empty DATABASE_URL as unset, as the clock always did", () => {
    expect(runtimeMode({ DATABASE_URL: "", DIVEDAY_CLOCK: CLOCK }).frozenClockMs).toBe(
      Date.parse(CLOCK),
    );
  });

  it("ignores an unparseable or empty clock", () => {
    expect(runtimeMode({ DIVEDAY_CLOCK: "not a date" }).frozenClockMs).toBeNull();
    expect(runtimeMode({ DIVEDAY_CLOCK: "" }).frozenClockMs).toBeNull();
  });

  it("returns a frozen record", () => {
    expect(Object.isFrozen(runtimeMode({}))).toBe(true);
    expect(Object.isFrozen(runtimeMode({ DATABASE_URL: REAL }))).toBe(true);
  });

  it("serves tide fixtures only under the harness or outside production, and never with a real database", () => {
    const off = { DIVEDAY_DISABLE_EXTERNAL_HTTP: "1" };
    expect(runtimeMode({ ...off, NODE_ENV: "development" }).syntheticFixtures).toBe(true);
    expect(
      runtimeMode({ ...off, NODE_ENV: "production", DIVEDAY_E2E: "1" }).syntheticFixtures,
    ).toBe(true);
    expect(runtimeMode({ ...off, NODE_ENV: "production" }).syntheticFixtures).toBe(false);
    expect(runtimeMode({ NODE_ENV: "development" }).syntheticFixtures).toBe(false);
  });

  it("marks cookies Secure in production and under a real database, not on the e2e loopback", () => {
    expect(runtimeMode({ NODE_ENV: "production" }).secureCookies).toBe(true);
    expect(runtimeMode({ NODE_ENV: "production", DIVEDAY_E2E: "1" }).secureCookies).toBe(false);
    expect(runtimeMode({ NODE_ENV: "development", DATABASE_URL: REAL }).secureCookies).toBe(true);
    expect(runtimeMode({ NODE_ENV: "production", DIVEDAY_E2E: "1" }).secureSessionCookies).toBe(
      false,
    );
  });
});
