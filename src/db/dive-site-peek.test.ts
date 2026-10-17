import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { upcomingTripsWithCounts } from "./trips";
import { getTripDiveSitesPeek } from "./trips-record";

const ctx = fileScopedShopContext();

describe("a dive-site briefing's diver-facing projection", () => {
  it("never reaches the projection every diver-facing site reader shares", async () => {
    // `getTripDiveSitesPeek` feeds the waiver success page and `/ready`. A
    // column added to its projection would publish a staff note to divers with
    // nothing failing, so the assertion is on the returned object's own keys.
    const { db, shop } = ctx;
    const [trip] = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    if (!trip) throw new Error("the seeded shop has no departures");
    const [peek] = await getTripDiveSitesPeek(db, trip.id);
    if (!peek) throw new Error("the seeded departure names no site");
    expect(Object.keys(peek)).toEqual([
      "name",
      "description",
      "difficultyLevel",
      "depthRange",
      "depthMinMeters",
      "maxDepthMeters",
      "imageUrls",
    ]);
  });
});
