import { describe, expect, it } from "vitest";
import { formatTime } from "./format";
import { moonAppearance, nightSkyFor } from "./sky";
import { wallTimeToUtc } from "./zoned";

/**
 * The demo shop's own coordinates (`src/db/seed.ts`) — Key Largo, which is
 * where every published sunset table this file was checked against is for.
 */
const KEY_LARGO = { latitude: 25.0865, longitude: -80.4473 };
const EASTERN = "America/New_York";

/** A departure at 11:00 PM Eastern on the given local evening. */
function lateEvening(localDate: string): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  return wallTimeToUtc({ year, month, day, hour: 23, minute: 0 }, EASTERN);
}

/** What a Florida diver would read off the clock. */
function eastern(at: Date | null): string | null {
  return at ? formatTime(at, "en-US", EASTERN) : null;
}

describe("nightSkyFor", () => {
  /**
   * Against published tables for Key Largo, FL. Each pair is within a minute of
   * the almanac, which is the whole accuracy claim the module makes.
   */
  it("puts sunset and civil dusk where the almanac does, across the year", () => {
    const cases = [
      // Local evening   sunset      civil dusk
      ["2026-06-21", "8:14 PM", "8:40 PM"],
      ["2026-09-07", "7:35 PM", "7:58 PM"],
      ["2026-03-15", "7:30 PM", "7:53 PM"],
      ["2026-01-01", "5:43 PM", "6:08 PM"],
    ] as const;
    for (const [date, sunset, dusk] of cases) {
      const sky = nightSkyFor({ startsAt: lateEvening(date), timeZone: EASTERN, ...KEY_LARGO });
      expect(sky, date).not.toBeNull();
      expect(eastern(sky?.sunsetAt ?? null), date).toBe(sunset);
      expect(eastern(sky?.civilDuskAt ?? null), date).toBe(dusk);
    }
  });

  it("answers for the departure's own local evening, not its UTC day", () => {
    // 7:30 PM Eastern on 2026-12-21 is already the 22nd in UTC. Anchoring on
    // the instant rather than the shop's local noon would answer for the wrong
    // solar day, which in December moves sunset by about a minute and in a
    // shoulder week moves it across the departure time itself.
    const sky = nightSkyFor({
      startsAt: new Date("2026-12-22T00:30:00Z"),
      timeZone: EASTERN,
      ...KEY_LARGO,
    });
    expect(eastern(sky?.sunsetAt ?? null)).toBe("5:37 PM");
  });

  it("works south of the equator and east of the meridian", () => {
    // Sydney at the June solstice: 4:53 PM local, its earliest sunset of the year.
    const sky = nightSkyFor({
      startsAt: new Date("2026-06-21T12:00:00Z"),
      timeZone: "Australia/Sydney",
      latitude: -33.87,
      longitude: 151.21,
    });
    expect(sky && formatTime(sky.sunsetAt, "en-US", "Australia/Sydney")).toBe("4:53 PM");
  });

  it("counts a departure that is still out at sunset", () => {
    // The demo shop's own night charter in July: it casts off at 7:30 PM, half
    // an hour before an 8:11 PM sunset, and dives both tanks in the dark.
    // Reading the start alone would drop the line from the one departure it is
    // written for, six months of the year.
    const sky = nightSkyFor({
      startsAt: new Date("2026-07-23T23:30:00Z"),
      endsAt: new Date("2026-07-24T03:00:00Z"),
      timeZone: EASTERN,
      ...KEY_LARGO,
    });
    expect(eastern(sky?.sunsetAt ?? null)).toBe("8:11 PM");
  });

  it("judges a multi-day run on its start, never on its last day's end", () => {
    // `endsAt` on a three-day Open Water is day three's 5:00 PM, which says
    // nothing about whether day one meets in the dark. Day one is a 9:00 AM.
    expect(
      nightSkyFor({
        startsAt: new Date("2026-01-02T14:00:00Z"),
        endsAt: new Date("2026-01-04T22:00:00Z"),
        timeZone: EASTERN,
        ...KEY_LARGO,
      }),
    ).toBeNull();
  });

  it("says nothing for a departure that is home before sunset", () => {
    // 2:00 PM to 5:30 PM Eastern in June: the two-tank reef trip, not a night
    // dive, and the shape of nearly every departure on every board.
    expect(
      nightSkyFor({
        startsAt: new Date("2026-06-21T18:00:00Z"),
        endsAt: new Date("2026-06-21T21:30:00Z"),
        timeZone: EASTERN,
        ...KEY_LARGO,
      }),
    ).toBeNull();
  });

  it("says the moon is down over a night charter that never sees it", () => {
    // A last quarter rises around midnight. The 7:30 PM charter is home at
    // 11:00 PM, so it dives the whole thing under a moonless sky — and the
    // day's phase, which is a true fact about 2026-01-10, would tell a diver
    // they had half a moon of light to pack around.
    const sky = nightSkyFor({
      startsAt: wallTimeToUtc({ year: 2026, month: 1, day: 10, hour: 19, minute: 30 }, EASTERN),
      endsAt: wallTimeToUtc({ year: 2026, month: 1, day: 10, hour: 23, minute: 0 }, EASTERN),
      timeZone: EASTERN,
      ...KEY_LARGO,
    });
    expect(sky?.moonOverDive).toBe("down");
    expect(sky?.moonriseAt).toBeNull();
    expect(sky?.moonsetAt).toBeNull();
    // The phase is still on the record — it is the *line* that suppresses it —
    // so a caller that wants the sky over the day can still have it.
    expect(sky?.phase).toBe("lastQuarter");
  });

  it("names the crossing when the moon goes down mid-dive", () => {
    // A thin waxing crescent follows the sun down: up when the boat leaves and
    // gone well before it is back, so the time worth printing is when it went.
    const sky = nightSkyFor({
      startsAt: wallTimeToUtc({ year: 2026, month: 1, day: 21, hour: 18, minute: 0 }, EASTERN),
      endsAt: wallTimeToUtc({ year: 2026, month: 1, day: 21, hour: 23, minute: 0 }, EASTERN),
      timeZone: EASTERN,
      ...KEY_LARGO,
    });
    expect(sky?.moonOverDive).toBe("sets");
    expect(sky?.moonriseAt).toBeNull();
    const moonsetAt = sky?.moonsetAt;
    expect(moonsetAt).toBeInstanceOf(Date);
    const setsAt = (moonsetAt as Date).getTime();
    // Inside the window it was asked about, which is the whole point.
    expect(setsAt).toBeGreaterThan(
      wallTimeToUtc({ year: 2026, month: 1, day: 21, hour: 18, minute: 0 }, EASTERN).getTime(),
    );
    expect(setsAt).toBeLessThan(
      wallTimeToUtc({ year: 2026, month: 1, day: 21, hour: 23, minute: 0 }, EASTERN).getTime(),
    );
  });

  it("keeps a full moon that is up for the whole dive, with no crossing to name", () => {
    const sky = nightSkyFor({
      startsAt: wallTimeToUtc({ year: 2026, month: 1, day: 3, hour: 19, minute: 30 }, EASTERN),
      endsAt: wallTimeToUtc({ year: 2026, month: 1, day: 3, hour: 23, minute: 0 }, EASTERN),
      timeZone: EASTERN,
      ...KEY_LARGO,
    });
    expect(sky?.moonOverDive).toBe("up");
    expect(sky?.moonriseAt).toBeNull();
    expect(sky?.moonsetAt).toBeNull();
    expect(sky?.phase).toBe("full");
  });

  it("says nothing when the shop has never set its coordinates", () => {
    // The address form is optional, and a whole timezone is far too coarse to
    // derive a sunset from — so no coordinates means no line, not a guess.
    expect(
      nightSkyFor({
        startsAt: lateEvening("2026-01-01"),
        timeZone: EASTERN,
        latitude: null,
        longitude: null,
      }),
    ).toBeNull();
  });

  it("says nothing where the sun never sets", () => {
    // Tromsø at midsummer. The hour angle has no solution, and the honest
    // answer is silence rather than a fabricated time.
    expect(
      nightSkyFor({
        startsAt: new Date("2026-06-21T22:00:00Z"),
        timeZone: "Europe/Oslo",
        latitude: 69.65,
        longitude: 18.96,
      }),
    ).toBeNull();
  });

  it("keeps sunset and drops civil dusk through a white night", () => {
    // Trondheim at midsummer: the sun sets, but it never falls six degrees
    // under, so there is a sunset to report and no moment the sky goes dark.
    const sky = nightSkyFor({
      startsAt: new Date("2026-06-21T21:50:00Z"),
      timeZone: "Europe/Oslo",
      latitude: 63.43,
      longitude: 10.4,
    });
    expect(sky?.sunsetAt).toBeInstanceOf(Date);
    expect(sky?.civilDuskAt).toBeNull();
  });
});

describe("moonAppearance", () => {
  /**
   * The four principal phases of early 2026, at the published instants. A
   * quarter is 50% lit and a full moon is 100%, which is the strongest check
   * available on a series with no observatory to compare against.
   */
  it("names the principal phases at the moment they happen", () => {
    const cases = [
      ["2026-01-03T10:03:00Z", "full", 100],
      ["2026-01-10T15:48:00Z", "lastQuarter", 50],
      ["2026-01-18T19:52:00Z", "new", 0],
      ["2026-01-26T04:47:00Z", "firstQuarter", 50],
    ] as const;
    for (const [instant, phase, percent] of cases) {
      const moon = moonAppearance(new Date(instant));
      expect(moon.phase, instant).toBe(phase);
      expect(Math.round(moon.illuminatedFraction * 100), instant).toBe(percent);
    }
  });

  it("distinguishes waxing from waning at the same illumination", () => {
    // Two nights either side of the January new moon, both thin crescents. A
    // diver planning ambient light cares which way the month is going.
    expect(moonAppearance(new Date("2026-01-13T00:00:00Z")).phase).toBe("waningCrescent");
    expect(moonAppearance(new Date("2026-01-23T00:00:00Z")).phase).toBe("waxingCrescent");
  });

  it("reads the illuminated fraction off the sky, not off a linear month", () => {
    // Three days past full the moon is still about 85% lit, not the 70% a
    // straight-line walk from full to last quarter would report. The
    // correction terms are what buy that.
    const moon = moonAppearance(new Date("2026-01-06T10:00:00Z"));
    expect(moon.illuminatedFraction).toBeGreaterThan(0.8);
    expect(moon.illuminatedFraction).toBeLessThan(0.92);
  });
});
