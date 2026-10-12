import { describe, expect, it } from "vitest";
import {
  MAX_MONTH_SPECIES,
  MIN_MONTH_TRIPS,
  MIN_SPECIES_TRIPS,
  rankMonthSightings,
} from "./month-sightings";

describe("the evidence threshold", () => {
  /**
   * Why eight: below it one departure moves every fraction by more than twelve
   * points, and a diver reads a printed rate as a promise. Pinned here with
   * the arithmetic, so changing the number means changing the argument.
   */
  it("is eight recorded departures, where one more trip moves a rate by at most 12.5 points", () => {
    expect(MIN_MONTH_TRIPS).toBe(8);
    expect(100 / MIN_MONTH_TRIPS).toBeLessThanOrEqual(12.5);
    expect(100 / (MIN_MONTH_TRIPS - 1)).toBeGreaterThan(12.5);
  });

  it("stays silent one departure short of it", () => {
    expect(
      rankMonthSightings({
        month: 3,
        trips: MIN_MONTH_TRIPS - 1,
        tallies: [{ speciesSlug: "green-sea-turtle", trips: 7 }],
      }),
    ).toBeNull();
  });

  it("speaks at it", () => {
    expect(
      rankMonthSightings({
        month: 3,
        trips: MIN_MONTH_TRIPS,
        tallies: [{ speciesSlug: "green-sea-turtle", trips: 5 }],
      }),
    ).toEqual({ month: 3, trips: 8, species: [{ speciesSlug: "green-sea-turtle", trips: 5 }] });
  });
});

describe("rankMonthSightings", () => {
  it("names no species seen on a single departure", () => {
    expect(MIN_SPECIES_TRIPS).toBe(2);
    expect(
      rankMonthSightings({
        month: 3,
        trips: 12,
        tallies: [{ speciesSlug: "whale-shark", trips: 1 }],
      }),
    ).toBeNull();
  });

  it("ranks by departures, then by slug, and cuts to the section's length", () => {
    const answer = rankMonthSightings({
      month: 10,
      trips: 20,
      tallies: [
        { speciesSlug: "e", trips: 3 },
        { speciesSlug: "b", trips: 9 },
        { speciesSlug: "a", trips: 9 },
        { speciesSlug: "c", trips: 4 },
        { speciesSlug: "d", trips: 2 },
      ],
    });
    expect(answer?.species.map((tally) => tally.speciesSlug)).toEqual(["a", "b", "c", "e"]);
    expect(answer?.species).toHaveLength(MAX_MONTH_SPECIES);
  });

  it("never claims a species on more departures than the month recorded", () => {
    const answer = rankMonthSightings({
      month: 3,
      trips: 9,
      tallies: [{ speciesSlug: "green-sea-turtle", trips: 11 }],
    });
    expect(answer?.species[0]?.trips).toBe(9);
  });
});
