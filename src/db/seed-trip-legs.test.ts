import { and, asc, eq, gte } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { DEFAULT_DOCK_DAY_RHYTHM, dockDayOffsets } from "@/lib/diver-planning";
import { seededShopContext } from "@/test/db";
import { tripDives, trips } from "./schema";

async function legsOf(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
  title: string,
) {
  // Upcoming only, for the same reason the seed itself is: `seed-history.ts`
  // back-fills sailed departures under these same titles, so a title-only
  // lookup can land on one of those instead.
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), eq(trips.title, title), gte(trips.startsAt, nowDate())))
    .limit(1);
  if (!trip) throw new Error(`expected the seeded departure "${title}"`);
  const dives = await db
    .select({ travelMinutes: tripDives.travelMinutes })
    .from(tripDives)
    .where(eq(tripDives.tripId, trip.id))
    .orderBy(asc(tripDives.diveNumber));
  return dives.map((dive) => dive.travelMinutes);
}

describe("seeded per-leg travel", () => {
  it("states real legs on the three departures that have one", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    // The house reef: a ride out shorter than the shop's own twenty, then the
    // next mooring down the line.
    expect(await legsOf(db, shop.id, "Two-Tank Reef — Molasses & French")).toEqual([15, 10]);
    // A long steam out, and then zero — both dives are on the same wreck. Zero
    // is an answer here, not an absence, and this is the only seeded row saying
    // it, so a reader that started treating 0 as "unstated" would be caught.
    expect(await legsOf(db, shop.id, "Wreck Trip — Spiegel Grove")).toEqual([40, 0]);
    expect(await legsOf(db, shop.id, "Tortugas Run — 3 days out, 6 divers to sail")).toEqual([
      120, 75, 25,
    ]);
  });

  it("leaves the rest of the board on the shop's own figure", async () => {
    // The fallback is a state worth seeing in the demo — it is what every
    // existing shop reads — so the seed deliberately does not fill everything
    // in. If this ever goes green-by-accident (because every departure got a
    // leg), the demo has stopped showing half the model.
    const { db, shop } = await seededShopContext({ history: true });
    expect(await legsOf(db, shop.id, "Two-Tank Reef — Benwood & Elbow")).toEqual([null, null]);
    expect(await legsOf(db, shop.id, "Two-Tank Reef — Christ of the Abyss")).toEqual([null, null]);
  });

  it("states none at all on a lean shop, where the shop's own numbers are the day", async () => {
    // A minted demo (and the lean unit-test template) runs with history off. A
    // stated leg *beats* `shops.boat_ride_minutes` — that is the whole point of
    // the column — so seeding one here silently defeats the shop-level setting
    // that a spec taking a shop of its own is usually testing. Asserted rather
    // than trusted: seeding these unconditionally made a shop that had just set
    // its ride out to zero read a fifteen-minute ride out, and it was right to.
    const { db, shop } = await seededShopContext();
    expect(await legsOf(db, shop.id, "Two-Tank Reef — Molasses & French")).toEqual([null, null]);
    expect(await legsOf(db, shop.id, "Wreck Trip — Spiegel Grove")).toEqual([null, null]);
  });

  it("gives the demo the one departure whose beat a leg actually renames", async () => {
    // The whole reason a seeded leg is worth having: between two dives the gap
    // is max(surfaceInterval, travel), so a leg *under* the shop's 60-minute
    // interval changes nothing a diver reads. Only the Tortugas run's second
    // leg is over it, and this asserts the consequence rather than the number —
    // the window is named a ride rather than a rest.
    const { db, shop } = await seededShopContext({ history: true });
    const legs = await legsOf(db, shop.id, "Tortugas Run — 3 days out, 6 divers to sail");
    const offsets = dockDayOffsets(DEFAULT_DOCK_DAY_RHYTHM, legs.length, undefined, legs);
    const betweenDives = offsets.filter(
      (offset) => offset.step === "boatRide" && (offset.number ?? 1) > 1,
    );
    expect(betweenDives).toHaveLength(1);

    // ...and the reef morning's short hop is swallowed by the interval, which is
    // the other half of the same rule.
    const reefLegs = await legsOf(db, shop.id, "Two-Tank Reef — Molasses & French");
    const reefOffsets = dockDayOffsets(
      DEFAULT_DOCK_DAY_RHYTHM,
      reefLegs.length,
      undefined,
      reefLegs,
    );
    expect(
      reefOffsets.some((offset) => offset.step === "boatRide" && (offset.number ?? 1) > 1),
    ).toBe(false);
    expect(reefOffsets.some((offset) => offset.step === "surfaceInterval")).toBe(true);
  });
});
