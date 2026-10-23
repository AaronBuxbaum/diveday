import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { upsertExecutedDive } from "./executed-dives";
import { MARINE_LIFE_CATALOG } from "./marine-life-catalog";
import {
  addCrewRecapPhoto,
  addRecapPhoto,
  canAddCrewRecapPhoto,
  canAddRecapPhoto,
  deleteRecapPhoto,
  getRecapPageData,
  listRecapPhotosForTrips,
} from "./recap";
import { executedDives, people, personRoles, shops, trips } from "./schema";
import { listStaff, upcomingTripsWithCounts } from "./trips";

/**
 * **A switched-off feature keeps what it holds** (ADR
 * 20261005-optional-shop-features, layer 3): the writers behind sightings and
 * recap photos refuse or leave a value alone while their switch is off, and
 * nothing already recorded is erased.
 */

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

describe("sightings switched off", () => {
  it("keeps the logged species when a dive is saved again", async () => {
    const { db, shop } = ctx;
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(1);
    const [species] = MARINE_LIFE_CATALOG;
    if (!owner || !trip || !species) throw new Error("fixture needs an owner, a trip, a species");
    await db.delete(executedDives).where(eq(executedDives.tripId, trip.id));
    await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      observedSpeciesSlug: species.slug,
      recordedByPersonId: owner.id,
    });

    // The form drew no species field; a save of the depth must not erase it,
    // even from a post that sends an empty one.
    const resaved = await upsertExecutedDive(db, {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 1,
      maxDepthMeters: 21,
      observedSpeciesSlug: null,
      keepObservedSpecies: true,
      recordedByPersonId: owner.id,
    });
    expect(resaved).toMatchObject({
      ok: true,
      dive: { maxDepthMeters: 21, observedSpeciesSlug: species.slug },
    });
  });
});

describe("recap photos switched off", () => {
  it("takes no photo from a diver or the crew, and keeps every one for takedown", async () => {
    const { db, shop } = ctx;
    const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = upcoming.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
    const [staff] = await listStaff(db, shop.id);
    if (!reef || !staff) throw new Error("demo reef trip or staff missing");
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Pia Photos",
        email: "pia.photos@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const bookingId = party.bookings[0].bookingId;
    const kept = await addRecapPhoto(db, { bookingId, imageUrl: "https://img/kept.jpg" });
    if (!kept.ok) throw new Error("photo not added");
    await db.update(shops).set({ diverPhotosEnabled: false }).where(eq(shops.id, shop.id));

    expect(await canAddRecapPhoto(db, bookingId)).toEqual({ ok: false, reason: "not_found" });
    expect(await addRecapPhoto(db, { bookingId, imageUrl: "https://img/new.jpg" })).toEqual({
      ok: false,
      reason: "not_found",
    });
    const crew = {
      shopId: shop.id,
      tripId: reef.id,
      uploadedByPersonId: staff.person.id,
      now: new Date(reef.endsAt.getTime() + 15 * 60 * 60 * 1000),
    };
    expect(await canAddCrewRecapPhoto(db, crew)).toEqual({ ok: false, reason: "not_found" });
    expect(await addCrewRecapPhoto(db, { ...crew, imageUrl: "https://img/crew.jpg" })).toEqual({
      ok: false,
      reason: "not_found",
    });

    // The diver's page shows no album; staff still see the photo to take it down.
    expect((await getRecapPageData(db, bookingId))?.photos).toEqual([]);
    const staffView = await listRecapPhotosForTrips(db, shop.id, [reef.id]);
    expect(staffView.some((photo) => photo.id === kept.photo.id)).toBe(true);
    expect(await deleteRecapPhoto(db, shop.id, kept.photo.id)).toEqual({
      deleted: true,
      imageUrl: "https://img/kept.jpg",
    });

    await db.update(shops).set({ diverPhotosEnabled: true }).where(eq(shops.id, shop.id));
    expect(await canAddRecapPhoto(db, bookingId)).toEqual({ ok: true });
  });
});
