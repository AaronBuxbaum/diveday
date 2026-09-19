import { describe, expect, it } from "vitest";
import { skyReadingFor } from "./sky-scheme";

/**
 * Key Largo on the canvas's own morning — the fiction every Tide board is drawn
 * on, so a number here can be checked against a picture.
 */
const KEY_LARGO = { latitude: 25.0865, longitude: -80.4473 };
const ZONE = "America/New_York";
const AUGUST_27 = (hour: number, minute = 0): Date =>
  new Date(Date.UTC(2026, 7, 27, hour + 4, minute)); // EDT is UTC-4

describe("skyReadingFor, over a place", () => {
  it("reads the sun rather than the clock", () => {
    const reading = skyReadingFor({ at: AUGUST_27(6, 40), timeZone: ZONE, ...KEY_LARGO });
    expect(reading.basis).toBe("almanac");
    expect(reading.sunriseAt).toBeInstanceOf(Date);
    expect(reading.sunsetAt).toBeInstanceOf(Date);
  });

  it("walks night, dawn, day, dusk, night through one day", () => {
    const scheme = (hour: number, minute = 0): string =>
      skyReadingFor({ at: AUGUST_27(hour, minute), timeZone: ZONE, ...KEY_LARGO }).scheme;
    // Sunrise is about 6:57 and sunset about 7:47 local on this date.
    expect(scheme(4)).toBe("night");
    expect(scheme(6, 40)).toBe("dawn");
    expect(scheme(7, 20)).toBe("dawn");
    expect(scheme(12)).toBe("day");
    expect(scheme(19, 30)).toBe("dusk");
    expect(scheme(21)).toBe("night");
  });

  /**
   * The reason this module exists rather than a clock band: the sun does not
   * keep office hours. Seven in the morning is full day in Key Largo in June
   * and still night in December, and one band cannot be both.
   */
  it("gives the same clock hour two different skies in two seasons", () => {
    const june = skyReadingFor({
      at: new Date(Date.UTC(2026, 5, 21, 10, 30)), // 6:30 AM EDT
      timeZone: ZONE,
      ...KEY_LARGO,
    });
    const december = skyReadingFor({
      at: new Date(Date.UTC(2026, 11, 21, 11, 0)), // 6:00 AM EST
      timeZone: "America/New_York",
      ...KEY_LARGO,
    });
    // Sunrise is about 6:30 in June and about 7:07 in December, so the same
    // early hour is the edge of the morning in one season and the middle of the
    // night in the other.
    expect(june.scheme).toBe("dawn");
    expect(december.scheme).toBe("night");
  });

  it("puts the sun a fraction of the way through its own daylight", () => {
    const morning = skyReadingFor({ at: AUGUST_27(8), timeZone: ZONE, ...KEY_LARGO });
    const afternoon = skyReadingFor({ at: AUGUST_27(17), timeZone: ZONE, ...KEY_LARGO });
    expect(morning.daylightProgress).toBeGreaterThan(0);
    expect(morning.daylightProgress).toBeLessThan(0.2);
    expect(afternoon.daylightProgress).toBeGreaterThan(0.7);
    expect(afternoon.daylightProgress).toBeLessThan(1);
  });

  it("has no progress to report while the sun is down", () => {
    expect(skyReadingFor({ at: AUGUST_27(3), timeZone: ZONE, ...KEY_LARGO }).daylightProgress).toBe(
      null,
    );
    expect(
      skyReadingFor({ at: AUGUST_27(23), timeZone: ZONE, ...KEY_LARGO }).daylightProgress,
    ).toBe(null);
  });
});

describe("skyReadingFor, with no place", () => {
  /**
   * The ordinary case for a shop that has done the least setup: the address
   * form is optional. A guessed sunrise would be worse than the clock, so the
   * clock is what it falls back to — and it says so, which is what lets a
   * surface offer the one line in Settings that upgrades it.
   */
  it("falls back to the shop's own clock, and says so", () => {
    const reading = skyReadingFor({
      at: AUGUST_27(6, 40),
      timeZone: ZONE,
      latitude: null,
      longitude: null,
    });
    expect(reading.basis).toBe("clock");
    expect(reading.scheme).toBe("dawn");
    expect(reading.sunriseAt).toBe(null);
    expect(reading.daylightProgress).toBe(null);
  });

  it("uses the clock's four bands, not the machine's hour", () => {
    const scheme = (hour: number): string =>
      skyReadingFor({
        at: AUGUST_27(hour),
        timeZone: ZONE,
        latitude: null,
        longitude: null,
      }).scheme;
    expect(scheme(6)).toBe("dawn");
    expect(scheme(12)).toBe("day");
    expect(scheme(18)).toBe("dusk");
    expect(scheme(23)).toBe("night");
  });

  it("falls back the same way where the sun never crosses the horizon", () => {
    // Longyearbyen in midsummer: the sun neither rises nor sets, so the almanac
    // has no crossing to offer and the clock answers.
    const reading = skyReadingFor({
      at: new Date(Date.UTC(2026, 5, 21, 10, 0)),
      timeZone: "Europe/Oslo",
      latitude: 78.22,
      longitude: 15.65,
    });
    expect(reading.basis).toBe("clock");
    expect(reading.scheme).toBe("day");
  });
});
