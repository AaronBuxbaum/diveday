import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import type { AppDb } from "./client";
import {
  clearFinishedRehearsals,
  isRehearsalTrip,
  rehearsalsWithEvidence,
  shopRehearsalIds,
} from "./rehearsals";
import {
  bookings,
  executedDives,
  people,
  personRoles,
  rollCallEvents,
  shops,
  trips,
} from "./schema";
import { createTrip } from "./trips";

/**
 * The module's own contract, one function at a time. The ADR's whole list of
 * places that honour a rehearsal is walked by `rehearsal-coverage.test.ts`;
 * this file pins the evidence rule the nightly delete trusts, and that every
 * read it makes stays inside one shop.
 */

const ctx = fileScopedShopContext();
const NOW = new Date("2031-05-10T12:00:00Z");
/** Far enough past any rehearsal here that only evidence can keep it. */
const late = (trip: { endsAt: Date }) => new Date(trip.endsAt.getTime() + 30 * 24 * HOUR_MS);

async function ownerOf(db: AppDb, shopId: string) {
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("seeded owner missing");
  return owner.id;
}

async function rehearsal(db: AppDb, shopId: string, isRehearsal = true) {
  const startsAt = new Date(NOW.getTime() + 48 * HOUR_MS);
  const trip = await createTrip(db, {
    shopId,
    title: "Training day drill",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: 6,
    priceCents: isRehearsal ? 0 : 12_000,
    isRehearsal,
  });
  if (!trip) throw new Error("fixture failed");
  const party = await createBookingParty(db, [
    { actor: "staff" as const, shopId, tripId: trip.id, fullName: "Test Diver" },
  ]);
  if (!party.ok) throw new Error(`seat refused: ${party.reason}`);
  return { trip, bookingId: party.bookings[0].bookingId };
}

async function otherShop(db: AppDb) {
  const [other] = await db
    .insert(shops)
    .values({ name: "Other Reef", slug: "other-reef-rehearsals", timezone: "UTC" })
    .returning();
  if (!other) throw new Error("other shop insert failed");
  return other;
}

describe("rehearsalsWithEvidence", () => {
  it("counts a boarding, an after-dive count and a logged dive, and nothing clerical", async () => {
    const { db, shop } = ctx;
    const ownerId = await ownerOf(db, shop.id);
    const boarded = await rehearsal(db, shop.id);
    const counted = await rehearsal(db, shop.id);
    const logged = await rehearsal(db, shop.id);
    const dockside = await rehearsal(db, shop.id);
    const unlogged = await rehearsal(db, shop.id);
    const event = (
      seat: { trip: { id: string }; bookingId: string },
      status: "boarded" | "not_boarded",
      checkpoint: "departure" | "after_dive_1",
    ) => ({
      shopId: shop.id,
      tripId: seat.trip.id,
      bookingId: seat.bookingId,
      recordedByPersonId: ownerId,
      occurredAt: NOW,
      status,
      checkpoint,
    });
    await db
      .insert(rollCallEvents)
      .values([
        event(boarded, "boarded", "departure"),
        event(counted, "not_boarded", "after_dive_1"),
        event(dockside, "not_boarded", "departure"),
      ]);
    await db.insert(executedDives).values([
      { shopId: shop.id, tripId: logged.trip.id, diveNumber: 1 },
      { shopId: shop.id, tripId: unlogged.trip.id, diveNumber: 1, deletedAt: NOW },
    ]);
    const all = [boarded, counted, logged, dockside, unlogged].map((seat) => seat.trip.id);
    const kept = await rehearsalsWithEvidence(db, shop.id, all);
    expect([...kept].sort()).toEqual([boarded.trip.id, counted.trip.id, logged.trip.id].sort());
  });

  it("reads evidence only inside the shop it is asked about", async () => {
    // The event tables are append-only and their indexes lead with
    // `shop_id`; a row stamped with another shop is not this shop's evidence.
    const { db, shop } = ctx;
    const other = await otherShop(db);
    const ownerId = await ownerOf(db, shop.id);
    const { trip, bookingId } = await rehearsal(db, shop.id);
    await db.insert(rollCallEvents).values({
      shopId: other.id,
      tripId: trip.id,
      bookingId,
      recordedByPersonId: ownerId,
      occurredAt: NOW,
      status: "boarded",
      checkpoint: "departure",
    });
    await db.insert(executedDives).values({ shopId: other.id, tripId: trip.id, diveNumber: 1 });
    expect((await rehearsalsWithEvidence(db, shop.id, [trip.id])).size).toBe(0);
    expect((await rehearsalsWithEvidence(db, other.id, [trip.id])).size).toBe(1);
  });

  it("answers an empty question without a query", async () => {
    expect((await rehearsalsWithEvidence(ctx.db, ctx.shop.id, [])).size).toBe(0);
  });
});

describe("clearFinishedRehearsals", () => {
  it("keeps a rehearsal with a boarded roll-call row and clears its evidence-free twin", async () => {
    const { db, shop } = ctx;
    const ownerId = await ownerOf(db, shop.id);
    const kept = await rehearsal(db, shop.id);
    const cleared = await rehearsal(db, shop.id);
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: kept.trip.id,
      bookingId: kept.bookingId,
      recordedByPersonId: ownerId,
      occurredAt: NOW,
      status: "boarded",
      checkpoint: "departure",
    });
    expect(await clearFinishedRehearsals(db, late(kept.trip))).toBe(1);
    const rows = await db
      .select({ id: trips.id, deletedAt: trips.deletedAt })
      .from(trips)
      .where(eq(trips.shopId, shop.id));
    const byId = new Map(rows.map((row) => [row.id, row.deletedAt]));
    expect(byId.get(kept.trip.id)).toBeNull();
    expect(byId.get(cleared.trip.id)).not.toBeNull();
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, kept.bookingId));
    expect(seat?.status).not.toBe("cancelled");
  });

  it("keeps a rehearsal with a logged dive", async () => {
    const { db, shop } = ctx;
    const { trip } = await rehearsal(db, shop.id);
    await db.insert(executedDives).values({ shopId: shop.id, tripId: trip.id, diveNumber: 1 });
    expect(await clearFinishedRehearsals(db, late(trip))).toBe(0);
  });

  it("never touches a real departure", async () => {
    const { db, shop } = ctx;
    const { trip, bookingId } = await rehearsal(db, shop.id, false);
    await clearFinishedRehearsals(db, late(trip));
    const [live] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(live?.deletedAt).toBeNull();
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(seat?.status).not.toBe("cancelled");
  });
});

describe("isRehearsalTrip and shopRehearsalIds", () => {
  it("answer inside one shop, cleared rehearsals included", async () => {
    const { db, shop } = ctx;
    const other = await otherShop(db);
    const { trip, bookingId } = await rehearsal(db, shop.id);
    const real = await rehearsal(db, shop.id, false);
    expect(await isRehearsalTrip(db, shop.id, trip.id)).toBe(true);
    expect(await isRehearsalTrip(db, other.id, trip.id)).toBe(false);
    expect(await isRehearsalTrip(db, shop.id, real.trip.id)).toBe(false);
    expect(await isRehearsalTrip(db, shop.id, "not-a-uuid")).toBe(false);
    await clearFinishedRehearsals(db, late(trip));
    expect(await isRehearsalTrip(db, shop.id, trip.id)).toBe(true);
    const ids = await shopRehearsalIds(db, shop.id);
    expect(ids.tripIds.has(trip.id)).toBe(true);
    expect(ids.bookingIds.has(bookingId)).toBe(true);
    expect(ids.tripIds.has(real.trip.id)).toBe(false);
    expect((await shopRehearsalIds(db, other.id)).tripIds.size).toBe(0);
  });
});
