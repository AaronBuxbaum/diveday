import { describe, expect, it } from "vitest";
import { moonTimesOn, SUN_HORIZON_ALTITUDE, solarEventsOn, sunMoonFor } from "./sun-moon";
import { wallTimeToUtc } from "./zoned";

/**
 * The demo shop's own coordinates (`src/db/seed.ts`) — Key Largo, which is
 * where the published tables this file is checked against are for. Sydney is
 * the southern-hemisphere twin: every sign in the solar series flips there, and
 * a hemisphere bug reads as a plausible time rather than as an error.
 */
const KEY_LARGO = { latitude: 25.0865, longitude: -80.4473 };
const EASTERN = "America/New_York";
const SYDNEY = { latitude: -33.87, longitude: 151.21 };
const SYDNEY_ZONE = "Australia/Sydney";

/** Noon on a local day — any instant inside it names the day. */
function localNoon(localDate: string, timeZone: string): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  return wallTimeToUtc({ year, month, day, hour: 12, minute: 0 }, timeZone);
}

function localClock(localDate: string, clock: string, timeZone: string): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  return wallTimeToUtc({ year, month, day, hour, minute }, timeZone);
}

/**
 * **Within a rounded minute of the almanac.** A published table prints whole
 * minutes, so an entry reading 7:07 AM is anywhere in that minute and a series
 * answering 7:06:40 agrees with it. Two minutes of band is one printed minute
 * either side, and it is the whole accuracy claim this module makes — tight
 * enough that a wrong hemisphere, a wrong solar day, or a dropped equation of
 * time all fail it by an order of magnitude.
 */
function expectClock(actual: Date | null, expected: Date, what: string) {
  expect(actual, what).not.toBeNull();
  expect(Math.abs((actual as Date).getTime() - expected.getTime()) / 60_000, what).toBeLessThan(2);
}

describe("sunMoonFor", () => {
  it("puts sunrise and sunset where the almanac does, across the year", () => {
    const cases = [
      // Local day     sunrise   sunset
      ["2026-06-21", "6:32", "20:14"],
      ["2026-01-01", "7:07", "17:43"],
      ["2026-09-07", "7:04", "19:35"],
    ] as const;
    for (const [date, sunrise, sunset] of cases) {
      const sky = sunMoonFor({ at: localNoon(date, EASTERN), timeZone: EASTERN, ...KEY_LARGO });
      expectClock(sky?.sunriseAt ?? null, localClock(date, sunrise, EASTERN), `${date} sunrise`);
      expectClock(sky?.sunsetAt ?? null, localClock(date, sunset, EASTERN), `${date} sunset`);
    }
  });

  it("works south of the equator and east of the meridian", () => {
    // Sydney at the June solstice — its shortest day, and the one where a
    // northern-hemisphere sign error reads as a long summer evening instead.
    const sky = sunMoonFor({
      at: localNoon("2026-06-21", SYDNEY_ZONE),
      timeZone: SYDNEY_ZONE,
      ...SYDNEY,
    });
    expectClock(sky?.sunriseAt ?? null, localClock("2026-06-21", "7:00", SYDNEY_ZONE), "sunrise");
    expectClock(sky?.sunsetAt ?? null, localClock("2026-06-21", "16:53", SYDNEY_ZONE), "sunset");
  });

  it("answers for the departure's own local day, not its UTC day", () => {
    // 11:00 PM Eastern on 2026-06-20 is already the 21st in UTC. Anchored on
    // the instant rather than on local noon, this would answer for the wrong
    // solar day — which is a minute in June and a shoulder week's worth of
    // difference either side of a solstice.
    const late = sunMoonFor({
      at: localClock("2026-06-20", "23:00", EASTERN),
      timeZone: EASTERN,
      ...KEY_LARGO,
    });
    expectClock(late?.sunsetAt ?? null, localClock("2026-06-20", "20:14", EASTERN), "sunset");
  });

  it("rises the moon with the sun at new moon and against it at full", () => {
    // The strongest check available without an observatory, and the one a diver
    // would notice being wrong: a full moon is opposite the sun, so it comes up
    // as the sun goes down; a new moon is beside it and comes up with it.
    const full = sunMoonFor({
      at: localNoon("2026-01-03", EASTERN),
      timeZone: EASTERN,
      ...KEY_LARGO,
    });
    expect(full?.phase).toBe("full");
    const fullMoonrise = full?.moonriseAt;
    const fullSunset = full?.sunsetAt;
    expect(fullMoonrise).toBeInstanceOf(Date);
    expect(fullSunset).toBeInstanceOf(Date);
    const afterSunset =
      ((fullMoonrise as Date).getTime() - (fullSunset as Date).getTime()) / 60_000;
    expect(Math.abs(afterSunset)).toBeLessThan(45);

    const dark = sunMoonFor({
      at: localNoon("2026-01-18", EASTERN),
      timeZone: EASTERN,
      ...KEY_LARGO,
    });
    expect(dark?.phase).toBe("new");
    const darkMoonrise = dark?.moonriseAt;
    const darkSunrise = dark?.sunriseAt;
    expect(darkMoonrise).toBeInstanceOf(Date);
    expect(darkSunrise).toBeInstanceOf(Date);
    const afterSunrise =
      ((darkMoonrise as Date).getTime() - (darkSunrise as Date).getTime()) / 60_000;
    expect(Math.abs(afterSunrise)).toBeLessThan(45);
  });

  it("reports the moon's own rise and set south of the equator too", () => {
    const sky = sunMoonFor({
      at: localNoon("2026-06-21", SYDNEY_ZONE),
      timeZone: SYDNEY_ZONE,
      ...SYDNEY,
    });
    expect(sky?.moonriseAt).toBeInstanceOf(Date);
    expect(sky?.moonsetAt).toBeInstanceOf(Date);
    // Both inside the local day they were asked for, which is what the hourly
    // walk is bounded to.
    const dayStart = localClock("2026-06-21", "0:00", SYDNEY_ZONE).getTime();
    for (const at of [sky?.moonriseAt, sky?.moonsetAt]) {
      expect((at as Date).getTime() - dayStart).toBeGreaterThanOrEqual(0);
      expect((at as Date).getTime() - dayStart).toBeLessThanOrEqual(25 * 3_600_000);
    }
  });

  it("says nothing at all when the shop has never set its coordinates", () => {
    // The address form is optional, and a whole timezone is far too coarse to
    // derive a sunrise from — so no coordinates means no line, not a guess.
    expect(
      sunMoonFor({
        at: localNoon("2026-06-21", EASTERN),
        timeZone: EASTERN,
        latitude: null,
        longitude: null,
      }),
    ).toBeNull();
    expect(
      sunMoonFor({
        at: localNoon("2026-06-21", EASTERN),
        timeZone: EASTERN,
        latitude: Number.NaN,
        longitude: -80,
      }),
    ).toBeNull();
  });

  it("drops the sun and keeps the moon where the sun never sets", () => {
    // Tromsø at midsummer. The hour angle has no solution, and the honest
    // answer for the sun is silence rather than a fabricated time — while the
    // moon still comes and goes, so its two fields still answer.
    const sky = sunMoonFor({
      at: localNoon("2026-06-21", "Europe/Oslo"),
      timeZone: "Europe/Oslo",
      latitude: 69.65,
      longitude: 18.96,
    });
    expect(sky?.sunriseAt).toBeNull();
    expect(sky?.sunsetAt).toBeNull();
    expect(sky?.phase).toBeTruthy();
  });
});

describe("solarEventsOn", () => {
  it("puts sunrise and sunset either side of local noon", () => {
    const dayNumber = 9_668; // 2026-06-21, whole days from J2000.
    const events = solarEventsOn(dayNumber, KEY_LARGO, SUN_HORIZON_ALTITUDE);
    expect(events.riseAt).toBeInstanceOf(Date);
    expect(events.setAt).toBeInstanceOf(Date);
    // Thirteen and three quarter hours of daylight at 25°N on the solstice.
    const hours =
      ((events.setAt as Date).getTime() - (events.riseAt as Date).getTime()) / 3_600_000;
    expect(hours).toBeGreaterThan(13.5);
    expect(hours).toBeLessThan(13.9);
  });

  it("answers null on both sides where the sun never reaches the altitude", () => {
    // Svalbard in December: the sun does not clear the horizon at all.
    const events = solarEventsOn(
      9_855,
      { latitude: 78.22, longitude: 15.65 },
      SUN_HORIZON_ALTITUDE,
    );
    expect(events.riseAt).toBeNull();
    expect(events.setAt).toBeNull();
  });
});

describe("moonTimesOn", () => {
  it("finds a rise and a set inside one day, in the day's own window", () => {
    const dayStart = localClock("2026-01-01", "0:00", EASTERN);
    const times = moonTimesOn(dayStart, KEY_LARGO);
    expect(times.riseAt).toBeInstanceOf(Date);
    expect(times.setAt).toBeInstanceOf(Date);
    // A waxing gibbous on New Year's Day sets in the small hours and comes back
    // up in the afternoon, so the set precedes the rise on this local day —
    // which is the case a naive "rise then set" ordering gets wrong.
    expect((times.setAt as Date).getTime()).toBeLessThan((times.riseAt as Date).getTime());
  });

  it("leaves one side null on the day the moon's fifty-minute drift eats it", () => {
    // The moon comes up about fifty minutes later each day, so roughly once a
    // month a local day holds a set and no rise, and a fortnight later a rise
    // and no set. Both are real answers, and inventing the missing one would
    // put a moonrise on a briefing for a night with none.
    expect(moonTimesOn(new Date("2026-01-09T05:00:00Z"), KEY_LARGO).riseAt).toBeNull();
    expect(moonTimesOn(new Date("2026-01-25T05:00:00Z"), KEY_LARGO).setAt).toBeNull();
  });

  it("answers null on both sides where the moon never crosses at all", () => {
    // Ten kilometres from the North Pole in June: the moon's declination is
    // well clear of the horizon for the fortnight, so it is simply down all
    // day and there is no crossing to report.
    const times = moonTimesOn(new Date("2026-06-15T00:00:00Z"), { latitude: 89.9, longitude: 0 });
    expect(times.riseAt).toBeNull();
    expect(times.setAt).toBeNull();
  });
});
