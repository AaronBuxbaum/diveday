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
      expect(fact).toContain("Southern stingray on 2 of 4 logged dives");
      expect(fact).toContain("30 days");
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
});
