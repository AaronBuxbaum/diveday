import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import type { SiteSightings } from "@/lib/sightings";
import { scheduleRowFact } from "./schedule-row-facts";

const now = new Date("2026-07-21T12:00:00Z");
const t = diverTranslator("en-US");
const shop = { depthUnit: "feet" as const, temperatureUnit: "fahrenheit" as const };
const seen: SiteSightings = {
  diveSiteId: "reef",
  dives: 4,
  species: [
    { speciesSlug: "retired-slug", dives: 4, total: 4, lastSeenAt: now },
    { speciesSlug: "southern-stingray", dives: 2, total: 2, lastSeenAt: now },
  ],
};
const trip = {
  startsAt: new Date("2026-07-22T12:00:00Z"),
  waterTemperatureC: null,
  visibilityMeters: null,
  surfaceConditions: null,
  conditionsSummary: null,
};

describe("scheduleRowFact", () => {
  it("prefers posted conditions in the next 48 hours using the trip page’s unit wording", () => {
    const fact = scheduleRowFact({ ...trip, waterTemperatureC: 27, visibilityMeters: 18 }, seen, {
      now,
      shop,
      t,
    });
    expect(fact).toContain("81°F water");
    expect(fact).toContain("59 ft visibility");
    expect(fact).not.toContain("stingray");
  });
  it("falls back to the top eligible recent sighting beyond 48 hours and for past trips", () => {
    for (const startsAt of [
      new Date("2026-07-23T12:00:00.001Z"),
      new Date("2026-07-21T11:59:59Z"),
    ]) {
      const fact = scheduleRowFact({ ...trip, startsAt, surfaceConditions: "Glassy" }, seen, {
        now,
        shop,
        t,
      });
      expect(fact).toBe("Southern stingrays seen on recent dives");
      expect(fact).not.toContain("Glassy");
    }
  });
  it("supports crew-written sightings and stays silent without eligible evidence", () => {
    expect(
      scheduleRowFact(
        trip,
        { ...seen, species: [{ ...seen.species[0], customName: "Eagle rays" }] },
        { now, shop, t },
      ),
    ).toContain("Eagle rays");
    expect(scheduleRowFact(trip, undefined, { now, shop, t })).toBeNull();
    expect(
      scheduleRowFact(trip, { ...seen, species: [seen.species[0]] }, { now, shop, t }),
    ).toBeNull();
  });

  describe("down a list that shows several rows", () => {
    const tallies = (...slugs: string[]): SiteSightings => ({
      diveSiteId: "reef",
      dives: 4,
      species: slugs.map((speciesSlug) => ({ speciesSlug, dives: 3, total: 3, lastSeenAt: now })),
    });
    const past = { ...trip, startsAt: new Date("2026-07-21T11:59:59Z") };
    const pick = (site: SiteSightings, shown: Map<string, number>) =>
      scheduleRowFact(past, site, { now, shop, t, shown });

    it("gives a later row the site’s next species instead of the sentence a row above used", () => {
      const shown = new Map<string, number>();
      const site = tallies("southern-stingray", "nurse-shark");
      expect(pick(site, shown)).toBe("Southern stingrays seen on recent dives");
      expect(pick(site, shown)).toBe("Nurse sharks seen on recent dives");
    });

    it("repeats a sentence once when the site has nothing else, then goes quiet", () => {
      const shown = new Map<string, number>();
      const site = tallies("southern-stingray");
      expect(pick(site, shown)).toBe("Southern stingrays seen on recent dives");
      expect(pick(site, shown)).toBe("Southern stingrays seen on recent dives");
      expect(pick(site, shown)).toBeNull();
    });

    it("never counts a posted-conditions reading as a repeat and never invents a fact", () => {
      const shown = new Map<string, number>();
      const near = { ...trip, waterTemperatureC: 27, visibilityMeters: 18 };
      scheduleRowFact(near, seen, { now, shop, t, shown });
      expect(shown.size).toBe(0);
      expect(pick({ ...seen, species: [seen.species[0]] }, shown)).toBeNull();
    });
  });
});
