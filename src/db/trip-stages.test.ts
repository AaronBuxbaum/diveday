// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { diveSites, people, personRoles, shops, tripDives, trips, userAccounts } from "./schema";
import {
  latestTripStage,
  latestTripStagesByTrip,
  liveShopStage,
  recordTripStage,
} from "./trip-stages";
import { createTrip } from "./trips";

/**
 * **A control on a safety surface** — ADR 20260904-reef-all-the-way-down,
 * Budget rule 4. The failure paths come first, because the writer's whole job
 * is to refuse a tap that should not be recorded, and because what this
 * publishes reaches an anonymous visitor.
 */
const ZONE = "America/New_York";
const NOW = new Date("2026-07-21T13:30:00.000Z");

async function freshShop(slug: string) {
  const db = await seededTestDb();
  const [shop] = await db
    .insert(shops)
    .values({ name: `Shop ${slug}`, slug, timezone: ZONE })
    .returning();
  if (!shop) throw new Error("test shop insert failed");
  return { db, shopId: shop.id };
}

async function aStaffer(db: AppDb, shopId: string, fullName = "Keiko Tanaka") {
  const [person] = await db.insert(people).values({ shopId, fullName }).returning();
  if (!person) throw new Error("test person insert failed");
  await db.insert(personRoles).values({ personId: person.id, role: "instructor" });
  // A role alone is not staff: `loadActiveStaffRoles` reads the account's
  // status, so a crew member with a disabled account is refused at the tap.
  await db.insert(userAccounts).values({
    personId: person.id,
    email: `${fullName.toLowerCase().replaceAll(" ", ".")}.${shopId.slice(0, 8)}@demo.invalid`,
    hashedPassword: "x",
  });
  return person.id;
}

async function aDiver(db: AppDb, shopId: string, fullName = "Ada Lindqvist") {
  const [person] = await db.insert(people).values({ shopId, fullName }).returning();
  if (!person) throw new Error("test person insert failed");
  return person.id;
}

async function aDeparture(
  db: AppDb,
  shopId: string,
  opts: { startsAt?: Date; isPrivate?: boolean; siteName?: string | null } = {},
) {
  const startsAt = opts.startsAt ?? new Date("2026-07-21T12:00:00.000Z");
  const trip = await createTrip(db, {
    shopId,
    title: "Two-Tank Reef",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
    capacity: 12,
    plannedDives: 2,
  });
  if (!trip) throw new Error("test trip insert failed");
  if (opts.isPrivate) await db.update(trips).set({ isPrivate: true }).where(eq(trips.id, trip.id));
  if (opts.siteName !== null) {
    const [site] = await db
      .insert(diveSites)
      // Unique per departure: a shop may not name two sites the same.
      .values({ shopId, name: opts.siteName ?? `Molasses Reef ${trip.id.slice(0, 8)}` })
      .returning();
    if (!site) throw new Error("test site insert failed");
    // `createTrip` already lays out one `trip_dives` row per planned dive, so
    // the plan is edited rather than added to.
    await db
      .update(tripDives)
      .set({ diveSiteId: site.id })
      .where(and(eq(tripDives.tripId, trip.id), eq(tripDives.diveNumber, 1)));
  }
  return trip;
}

describe("recordTripStage", () => {
  it("refuses a person who is not staff at this shop", async () => {
    const { db, shopId } = await freshShop("stage-not-staff");
    const trip = await aDeparture(db, shopId);
    const diver = await aDiver(db, shopId);
    expect(
      await recordTripStage(db, {
        shopId,
        tripId: trip.id,
        stage: "underway",
        recordedByPersonId: diver,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });
  });

  it("refuses another shop's departure", async () => {
    const { db, shopId } = await freshShop("stage-tenant");
    const [other] = await db
      .insert(shops)
      .values({ name: "Neighbour", slug: "stage-neighbour", timezone: ZONE })
      .returning();
    if (!other) throw new Error("neighbour insert failed");
    const theirs = await aDeparture(db, other.id);
    const staffer = await aStaffer(db, shopId);
    expect(
      await recordTripStage(db, {
        shopId,
        tripId: theirs.id,
        stage: "underway",
        recordedByPersonId: staffer,
      }),
    ).toEqual({ ok: false, reason: "trip_unavailable" });
  });

  it("refuses a departure the shop deleted", async () => {
    const { db, shopId } = await freshShop("stage-deleted");
    const trip = await aDeparture(db, shopId);
    const staffer = await aStaffer(db, shopId);
    await db.update(trips).set({ deletedAt: NOW }).where(eq(trips.id, trip.id));
    expect(
      await recordTripStage(db, {
        shopId,
        tripId: trip.id,
        stage: "underway",
        recordedByPersonId: staffer,
      }),
    ).toEqual({ ok: false, reason: "trip_unavailable" });
  });

  it("stamps the site off the plan, and a later edit does not rewrite it", async () => {
    const { db, shopId } = await freshShop("stage-site-snapshot");
    const trip = await aDeparture(db, shopId, { siteName: "Molasses Reef" });
    const staffer = await aStaffer(db, shopId);
    await recordTripStage(db, {
      shopId,
      tripId: trip.id,
      stage: "underway",
      recordedByPersonId: staffer,
    });

    const [elsewhere] = await db
      .insert(diveSites)
      .values({ shopId, name: "French Reef" })
      .returning();
    if (!elsewhere) throw new Error("second site insert failed");
    await db
      .update(tripDives)
      .set({ diveSiteId: elsewhere.id })
      .where(eq(tripDives.tripId, trip.id));

    expect(await latestTripStage(db, shopId, trip.id)).toMatchObject({
      stage: "underway",
      siteName: "Molasses Reef",
    });
  });

  it("has no site to stamp on a departure with no plan", async () => {
    const { db, shopId } = await freshShop("stage-no-site");
    const trip = await aDeparture(db, shopId, { siteName: null });
    const staffer = await aStaffer(db, shopId);
    await recordTripStage(db, {
      shopId,
      tripId: trip.id,
      stage: "underway",
      recordedByPersonId: staffer,
    });
    expect(await latestTripStage(db, shopId, trip.id)).toMatchObject({ siteName: null });
  });

  it("lets the crew take a word back by saying the next one", async () => {
    const { db, shopId } = await freshShop("stage-newest-wins");
    const trip = await aDeparture(db, shopId);
    const staffer = await aStaffer(db, shopId);
    await recordTripStage(db, {
      shopId,
      tripId: trip.id,
      stage: "underway",
      recordedByPersonId: staffer,
      recordedAt: new Date("2026-07-21T12:10:00.000Z"),
    });
    await recordTripStage(db, {
      shopId,
      tripId: trip.id,
      stage: "boarding",
      recordedByPersonId: staffer,
      recordedAt: new Date("2026-07-21T12:20:00.000Z"),
    });
    expect(await latestTripStage(db, shopId, trip.id)).toMatchObject({
      stage: "boarding",
      recordedByName: "Keiko Tanaka",
    });
  });
});

describe("latestTripStagesByTrip", () => {
  it("answers one stage per departure in a single pass", async () => {
    const { db, shopId } = await freshShop("stage-by-trip");
    const morning = await aDeparture(db, shopId, {
      startsAt: new Date("2026-07-21T11:00:00.000Z"),
    });
    const afternoon = await aDeparture(db, shopId, {
      startsAt: new Date("2026-07-21T17:00:00.000Z"),
    });
    const quiet = await aDeparture(db, shopId, { startsAt: new Date("2026-07-21T21:00:00.000Z") });
    const staffer = await aStaffer(db, shopId);
    await recordTripStage(db, {
      shopId,
      tripId: morning.id,
      stage: "home",
      recordedByPersonId: staffer,
    });
    await recordTripStage(db, {
      shopId,
      tripId: afternoon.id,
      stage: "underway",
      recordedByPersonId: staffer,
    });

    const byTrip = await latestTripStagesByTrip(db, shopId, [morning.id, afternoon.id, quiet.id]);
    expect(byTrip.get(morning.id)?.stage).toBe("home");
    expect(byTrip.get(afternoon.id)?.stage).toBe("underway");
    expect(byTrip.has(quiet.id)).toBe(false);
  });
});

describe("liveShopStage", () => {
  const windowStart = new Date("2026-07-21T00:00:00.000Z");

  it("says nothing when no crew has said anything", async () => {
    const { db, shopId } = await freshShop("live-quiet");
    await aDeparture(db, shopId);
    expect(await liveShopStage(db, shopId, NOW, windowStart)).toBeNull();
  });

  it("names the boat a crew said is out", async () => {
    const { db, shopId } = await freshShop("live-out");
    const trip = await aDeparture(db, shopId);
    const staffer = await aStaffer(db, shopId);
    await recordTripStage(db, {
      shopId,
      tripId: trip.id,
      stage: "underway",
      recordedByPersonId: staffer,
      recordedAt: new Date("2026-07-21T12:10:00.000Z"),
    });
    expect(await liveShopStage(db, shopId, NOW, windowStart)).toMatchObject({
      stage: "underway",
      tripId: trip.id,
    });
  });

  it("never publishes a private charter", async () => {
    const { db, shopId } = await freshShop("live-private");
    const trip = await aDeparture(db, shopId, { isPrivate: true });
    const staffer = await aStaffer(db, shopId);
    await recordTripStage(db, {
      shopId,
      tripId: trip.id,
      stage: "underway",
      recordedByPersonId: staffer,
      recordedAt: new Date("2026-07-21T12:10:00.000Z"),
    });
    expect(await liveShopStage(db, shopId, NOW, windowStart)).toBeNull();
  });

  it("never publishes a boat that is home", async () => {
    const { db, shopId } = await freshShop("live-home");
    const trip = await aDeparture(db, shopId);
    const staffer = await aStaffer(db, shopId);
    await recordTripStage(db, {
      shopId,
      tripId: trip.id,
      stage: "home",
      recordedByPersonId: staffer,
      recordedAt: new Date("2026-07-21T12:10:00.000Z"),
    });
    expect(await liveShopStage(db, shopId, NOW, windowStart)).toBeNull();
  });

  it("stops publishing a stage older than the boat's own day", async () => {
    const { db, shopId } = await freshShop("live-stale");
    const trip = await aDeparture(db, shopId);
    const staffer = await aStaffer(db, shopId);
    await recordTripStage(db, {
      shopId,
      tripId: trip.id,
      stage: "underway",
      recordedByPersonId: staffer,
      recordedAt: new Date("2026-07-21T12:10:00.000Z"),
    });
    // The departure ended at 16:00Z; this is well past the two-hour grace.
    expect(
      await liveShopStage(db, shopId, new Date("2026-07-22T02:00:00.000Z"), windowStart),
    ).toBeNull();
  });

  it("never publishes a cancelled departure", async () => {
    const { db, shopId } = await freshShop("live-cancelled");
    const trip = await aDeparture(db, shopId);
    const staffer = await aStaffer(db, shopId);
    await recordTripStage(db, {
      shopId,
      tripId: trip.id,
      stage: "underway",
      recordedByPersonId: staffer,
      recordedAt: new Date("2026-07-21T12:10:00.000Z"),
    });
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
    expect(await liveShopStage(db, shopId, NOW, windowStart)).toBeNull();
  });

  it("never reads another shop's boat", async () => {
    const { db, shopId } = await freshShop("live-tenant");
    const [other] = await db
      .insert(shops)
      .values({ name: "Neighbour", slug: "live-neighbour", timezone: ZONE })
      .returning();
    if (!other) throw new Error("neighbour insert failed");
    const theirs = await aDeparture(db, other.id);
    const theirStaffer = await aStaffer(db, other.id, "Sal Moretti");
    await recordTripStage(db, {
      shopId: other.id,
      tripId: theirs.id,
      stage: "underway",
      recordedByPersonId: theirStaffer,
      recordedAt: new Date("2026-07-21T12:10:00.000Z"),
    });
    expect(await liveShopStage(db, shopId, NOW, windowStart)).toBeNull();
  });
});
