import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { diveSites, executedDives, tripDives, trips } from "./schema";
import { lastAtSites } from "./site-history";
import { listStaff } from "./trips";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/** Three departures in clock order with no dives of their own, and two sites. */
async function historyContext() {
  const { db, shop } = ctx;
  const three = await db
    .select({ id: trips.id, startsAt: trips.startsAt })
    .from(trips)
    .where(and(eq(trips.shopId, shop.id), isNull(trips.deletedAt)))
    .orderBy(asc(trips.startsAt), asc(trips.id))
    .limit(3);
  const ids = three.map((trip) => trip.id);
  await db.delete(executedDives).where(inArray(executedDives.tripId, ids));
  await db.delete(tripDives).where(inArray(tripDives.tripId, ids));
  const [molasses, french] = await db
    .select({ id: diveSites.id, name: diveSites.name })
    .from(diveSites)
    .where(eq(diveSites.shopId, shop.id))
    .orderBy(asc(diveSites.name))
    .limit(2);
  const [first, second, third] = three;
  const recorder = (await listStaff(db, shop.id))[0]?.person;
  if (!first || !second || !third || !molasses || !french || !recorder) {
    throw new Error("demo trips, sites or staff missing");
  }
  const logDive = (
    tripId: string,
    actualSiteId: string,
    conditions: Record<string, unknown> | null = null,
  ) =>
    db.insert(executedDives).values({
      shopId: shop.id,
      tripId,
      diveNumber: 1,
      actualSiteId,
      observedConditions: conditions,
      recordedByPersonId: recorder.id,
    });
  const plan = (tripId: string, diveSiteId: string) =>
    db.insert(tripDives).values({ tripId, diveNumber: 1, diveSiteId });
  return { db, shop, first, second, third, molasses, french, recorder, logDive, plan };
}

describe("lastAtSites (in-memory PGlite)", () => {
  it("reads the crew's words from the last earlier dive on the site", async () => {
    const { db, shop, first, second, third, molasses, recorder, logDive } = await historyContext();
    await logDive(first.id, molasses.id, { visibility: "60 ft", current: "none" });
    await logDive(second.id, molasses.id, { visibility: " 40 ft ", current: "light, north" });
    const history = await lastAtSites(db, {
      shopId: shop.id,
      siteIds: [molasses.id],
      before: third.startsAt,
      excludeTripId: third.id,
    });
    expect(history.get(molasses.id)).toMatchObject({
      kind: "dived",
      visibility: "40 ft",
      current: "light, north",
      recordedByName: recorder.fullName,
      actualSiteName: molasses.name,
    });
  });

  it("says the boat moved when the last plan for the site went elsewhere", async () => {
    const { db, shop, first, second, third, molasses, french, logDive, plan } =
      await historyContext();
    await logDive(first.id, molasses.id);
    await plan(second.id, molasses.id);
    await logDive(second.id, french.id);
    const history = await lastAtSites(db, {
      shopId: shop.id,
      siteIds: [molasses.id],
      before: third.startsAt,
      excludeTripId: third.id,
    });
    expect(history.get(molasses.id)).toMatchObject({
      kind: "moved",
      actualSiteName: french.name,
    });
  });

  it("is silent for a site never dived and never reads the departure's own log", async () => {
    const { db, shop, third, molasses, french, logDive } = await historyContext();
    await logDive(third.id, molasses.id);
    const history = await lastAtSites(db, {
      shopId: shop.id,
      siteIds: [molasses.id, french.id],
      before: new Date(third.startsAt.getTime() + 1),
      excludeTripId: third.id,
    });
    expect(history.size).toBe(0);
  });
});
