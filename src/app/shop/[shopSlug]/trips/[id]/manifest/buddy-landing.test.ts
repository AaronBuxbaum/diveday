import { describe, expect, it } from "vitest";
import { buddyActLandsAt } from "./buddy-landing";

const trip = { shopSlug: "blue-mantis", tripId: "trip-1", checkpoint: "departure" as const };

describe("where a buddy-team act lands", () => {
  it("returns to the trip phase it was made from, with the teams open", () => {
    expect(buddyActLandsAt({ ...trip, buddySurface: "ready" })).toBe(
      "/shop/blue-mantis/trips/trip-1?phase=ready&buddies=open",
    );
    expect(buddyActLandsAt({ ...trip, buddySurface: "checkin" })).toBe(
      "/shop/blue-mantis/trips/trip-1?phase=checkin&buddies=open",
    );
  });

  it("returns to Roll call at the same checkpoint when made there", () => {
    expect(buddyActLandsAt({ ...trip, checkpoint: "after_dive_1" })).toBe(
      "/shop/blue-mantis/trips/trip-1/manifest?checkpoint=after_dive_1&buddies=open",
    );
  });
});
