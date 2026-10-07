import { randomUUID } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { countQueries } from "@/test/query-count";
import { people, personRoles, trips } from "./schema";
import { getTripGuests } from "./trips-guests";
import { liveTrip } from "./trips-live";
import { getTripOverview } from "./trips-overview";
import { loadTripSharedReads } from "./trips-shared-reads";

async function upcomingTripContext() {
  const { db, shop } = await seededShopContext();
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.shopId, shop.id), liveTrip(), gt(trips.startsAt, nowDate())))
    .orderBy(asc(trips.startsAt))
    .limit(1);
  const [owner] = await db
    .select({ id: people.id })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!trip || !owner) throw new Error("the seeded shop has no upcoming departure or owner");
  return { db, shop, tripId: trip.id, ownerId: owner.id };
}

describe("the trip page's shared reads", () => {
  it("hands Overview and Guests the answers they would have read themselves", async () => {
    const { db, shop, tripId, ownerId } = await upcomingTripContext();
    const now = nowDate();
    const shared = loadTripSharedReads(db, shop.id, tripId);
    const [overviewShared, guestsShared, overviewAlone, guestsAlone] = await Promise.all([
      getTripOverview(db, shop, tripId, ownerId, now, shared),
      getTripGuests(db, shop, tripId, {}, shared),
      getTripOverview(db, shop, tripId, ownerId, now),
      getTripGuests(db, shop, tripId),
    ]);
    expect(overviewShared).not.toBeNull();
    expect(overviewShared).toEqual(overviewAlone);
    expect(guestsShared).toEqual(guestsAlone);
  });

  it("answers null for a departure that does not exist, through either reader", async () => {
    const { db, shop, ownerId } = await upcomingTripContext();
    const missing = randomUUID();
    const shared = loadTripSharedReads(db, shop.id, missing);
    expect(await getTripOverview(db, shop, missing, ownerId, nowDate(), shared)).toBeNull();
    expect(await getTripGuests(db, shop, missing, {}, shared)).toBeNull();
  });

  it("reads the five once instead of once per reader", async () => {
    const { db, shop, tripId, ownerId } = await upcomingTripContext();
    const log = countQueries(db);
    await Promise.all([
      getTripOverview(log.db, shop, tripId, ownerId),
      getTripGuests(log.db, shop, tripId),
    ]);
    const separately = log.count();
    log.reset();
    const shared = loadTripSharedReads(log.db, shop.id, tripId);
    await Promise.all([
      getTripOverview(log.db, shop, tripId, ownerId, undefined, shared),
      getTripGuests(log.db, shop, tripId, {}, shared),
    ]);
    // The trip row, requirements, site requirement, readiness and prep list:
    // at least the five readers' own statements stop being paid twice.
    expect(separately - log.count()).toBeGreaterThanOrEqual(5);
  });
});
