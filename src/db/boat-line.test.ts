// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { diveSiteSlugFrom } from "@/lib/dive-site-slug";
import { seededTestDb } from "@/test/db";
import { publicBoatLine } from "./boat-line";
import type { AppDb } from "./client";
import { boats, diveSites, people, shops, tripDives, tripStageEvents, trips } from "./schema";
import { createTrip } from "./trips";

/**
 * **A page a stranger holds.** The refusals come first, and the last test in
 * this file is the one that matters most: whatever else changes here, the
 * shape this returns must never grow a person, a count of people, or a
 * position (ADR 20260908-one-hand, decision 6, lever U).
 */
const ZONE = "America/New_York";
const STARTS_AT = new Date("2026-08-27T11:00:00.000Z");
const NOW = new Date("2026-08-27T13:12:00.000Z");

async function aShop(slug: string, opts: { publicBoatLine?: boolean } = {}) {
  const db = await seededTestDb();
  const [shop] = await db
    .insert(shops)
    .values({
      name: `Shop ${slug}`,
      slug,
      timezone: ZONE,
      publicBoatLine: opts.publicBoatLine ?? true,
    })
    .returning();
  if (!shop) throw new Error("test shop insert failed");
  return { db, shopId: shop.id, slug };
}

async function aDeparture(
  db: AppDb,
  shopId: string,
  opts: { siteNames?: readonly string[]; plannedDives?: number; endsAt?: Date } = {},
) {
  const siteNames = opts.siteNames ?? ["Molasses Reef", "French Reef"];
  const trip = await createTrip(db, {
    shopId,
    title: "Two-Tank Reef",
    startsAt: STARTS_AT,
    endsAt: opts.endsAt ?? new Date("2026-08-27T14:30:00.000Z"),
    capacity: 12,
    plannedDives: opts.plannedDives ?? siteNames.length,
  });
  if (!trip) throw new Error("test trip insert failed");
  for (const [index, name] of siteNames.entries()) {
    const siteName = `${name} ${trip.id.slice(0, 8)}`;
    const [site] = await db
      .insert(diveSites)
      // Unique per shop, so each departure's sites carry the trip's own suffix.
      .values({ shopId, name: siteName, slug: diveSiteSlugFrom(siteName) })
      .returning();
    if (!site) throw new Error("test site insert failed");
    await db
      .update(tripDives)
      .set({ diveSiteId: site.id })
      .where(and(eq(tripDives.tripId, trip.id), eq(tripDives.diveNumber, index + 1)));
  }
  return trip;
}

async function aWord(
  db: AppDb,
  shopId: string,
  tripId: string,
  stage: "boarding" | "underway" | "surface" | "heading_in" | "home",
  recordedAt: Date,
) {
  const [crew] = await db
    .insert(people)
    .values({ shopId, fullName: `Crew ${tripId.slice(0, 8)}` })
    .returning();
  if (!crew) throw new Error("test crew insert failed");
  await db
    .insert(tripStageEvents)
    .values({ shopId, tripId, stage, recordedAt, recordedByPersonId: crew.id });
}

describe("publicBoatLine", () => {
  it("answers with the departure's day when the shop has said yes", async () => {
    const { db, shopId, slug } = await aShop("boat-line-yes");
    const trip = await aDeparture(db, shopId);
    await aWord(db, shopId, trip.id, "surface", new Date("2026-08-27T12:52:00.000Z"));

    const line = await publicBoatLine(db, { shopSlug: slug, tripId: trip.id, now: NOW });
    expect(line?.trip.title).toBe("Two-Tank Reef");
    expect(line?.siteNames).toHaveLength(2);
    expect(line?.siteNames[0]).toContain("Molasses Reef");
    expect(line?.word).toEqual({
      stage: "surface",
      recordedAt: new Date("2026-08-27T12:52:00.000Z"),
    });
  });

  it("names the hull the shop keeps on file", async () => {
    const { db, shopId, slug } = await aShop("boat-line-hull");
    const trip = await aDeparture(db, shopId);
    const [boat] = await db
      .insert(boats)
      .values({ shopId, name: "Mantis II", capacity: 12 })
      .returning();
    if (!boat) throw new Error("test boat insert failed");
    await db.update(trips).set({ boatId: boat.id }).where(eq(trips.id, trip.id));

    const line = await publicBoatLine(db, { shopSlug: slug, tripId: trip.id, now: NOW });
    expect(line?.trip.boatName).toBe("Mantis II");
  });

  it("says nothing at all while the switch is off", async () => {
    const { db, shopId, slug } = await aShop("boat-line-off", { publicBoatLine: false });
    const trip = await aDeparture(db, shopId);
    await aWord(db, shopId, trip.id, "underway", new Date("2026-08-27T11:05:00.000Z"));
    expect(await publicBoatLine(db, { shopSlug: slug, tripId: trip.id, now: NOW })).toBeNull();
  });

  it("refuses a departure the shop cancelled", async () => {
    const { db, shopId, slug } = await aShop("boat-line-cancelled");
    const trip = await aDeparture(db, shopId);
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
    expect(await publicBoatLine(db, { shopSlug: slug, tripId: trip.id, now: NOW })).toBeNull();
  });

  it("refuses a departure the shop deleted", async () => {
    const { db, shopId, slug } = await aShop("boat-line-deleted");
    const trip = await aDeparture(db, shopId);
    await db.update(trips).set({ deletedAt: NOW }).where(eq(trips.id, trip.id));
    expect(await publicBoatLine(db, { shopSlug: slug, tripId: trip.id, now: NOW })).toBeNull();
  });

  it("refuses a private charter, whose title is somebody's name often enough", async () => {
    const { db, shopId, slug } = await aShop("boat-line-private");
    const trip = await aDeparture(db, shopId);
    await db.update(trips).set({ isPrivate: true }).where(eq(trips.id, trip.id));
    expect(await publicBoatLine(db, { shopSlug: slug, tripId: trip.id, now: NOW })).toBeNull();
  });

  it("refuses another shop's departure through this shop's slug", async () => {
    const { db, shopId, slug } = await aShop("boat-line-tenant");
    const [other] = await db
      .insert(shops)
      .values({
        name: "Neighbour",
        slug: "boat-line-neighbour",
        timezone: ZONE,
        publicBoatLine: true,
      })
      .returning();
    if (!other) throw new Error("neighbour insert failed");
    const theirs = await aDeparture(db, other.id);
    expect(await publicBoatLine(db, { shopSlug: slug, tripId: theirs.id, now: NOW })).toBeNull();
    // And the shop that owns it still answers, so the refusal above is the
    // tenant check rather than a broken query.
    expect(
      await publicBoatLine(db, { shopSlug: "boat-line-neighbour", tripId: theirs.id, now: NOW }),
    ).not.toBeNull();
    expect(shopId).not.toBe(other.id);
  });

  it("stops answering once the departure's day has closed", async () => {
    const { db, shopId, slug } = await aShop("boat-line-over");
    const trip = await aDeparture(db, shopId);
    await aWord(db, shopId, trip.id, "home", new Date("2026-08-27T14:35:00.000Z"));
    // The published return plus one stale-stage window is the last moment the
    // page answers; the next morning is not.
    expect(
      await publicBoatLine(db, {
        shopSlug: slug,
        tripId: trip.id,
        now: new Date("2026-08-28T09:00:00.000Z"),
      }),
    ).toBeNull();
  });

  it("answers before the boat has sailed, with nothing said yet", async () => {
    const { db, shopId, slug } = await aShop("boat-line-dock");
    const trip = await aDeparture(db, shopId);
    const line = await publicBoatLine(db, {
      shopSlug: slug,
      tripId: trip.id,
      now: new Date("2026-08-27T09:00:00.000Z"),
    });
    expect(line?.word).toBeNull();
    expect(line?.trip.startsAt).toEqual(STARTS_AT);
  });

  it("keeps a dive with no site named on the plan rather than dropping it", async () => {
    const { db, shopId, slug } = await aShop("boat-line-siteless");
    const trip = await aDeparture(db, shopId, { siteNames: [], plannedDives: 2 });
    const line = await publicBoatLine(db, { shopSlug: slug, tripId: trip.id, now: NOW });
    expect(line?.siteNames).toEqual([null, null]);
  });

  it("carries no person, no count of people, and no position", async () => {
    const { db, shopId, slug } = await aShop("boat-line-shape");
    const trip = await aDeparture(db, shopId);
    await aWord(db, shopId, trip.id, "underway", new Date("2026-08-27T11:05:00.000Z"));
    const line = await publicBoatLine(db, { shopSlug: slug, tripId: trip.id, now: NOW });
    if (!line) throw new Error("expected a line");
    const serialized = JSON.stringify(line);
    for (const forbidden of [
      "capacity",
      "booked",
      "seats",
      "spots",
      "roster",
      "personId",
      "recordedByName",
      "latitude",
      "longitude",
      "coordinates",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(Object.keys(line).sort()).toEqual([
      "legTravelTimes",
      "shop",
      "siteBottomTimes",
      "siteNames",
      "trip",
      "word",
    ]);
    expect(Object.keys(line.word ?? {}).sort()).toEqual(["recordedAt", "stage"]);
  });
});
