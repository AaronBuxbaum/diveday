import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { listDeskEventsSince, markTripCaughtUp, recordDeskEvent } from "./desk-events";
import { bookings, people, personRoles, shops, tripReadMarks, trips } from "./schema";

/**
 * The catch-up strip's reader, against a real database (issues #1202, #1187).
 *
 * The fixture takes the seeded owner as the *reader* and the seeded lead
 * instructor as the *desk* — two different people, because the one thing this
 * reader must never be told about is their own act.
 */
async function catchUpFixture() {
  const { db, shop } = await seededShopContext();
  const staff = await db
    .select({ id: people.id, role: personRoles.role, name: people.fullName })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), isNull(people.deletedAt)));
  const reader = staff.find((row) => row.role === "owner");
  const desk = staff.find((row) => row.role === "instructor" && row.id !== reader?.id);
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(eq(trips.shopId, shop.id))
    .limit(1);
  if (!reader || !desk || !trip) throw new Error("catch-up fixture needs two staff and a trip");
  const roster = await db
    .select({ id: bookings.id, personId: bookings.personId })
    .from(bookings)
    .where(and(eq(bookings.shopId, shop.id), eq(bookings.tripId, trip.id)))
    .limit(2);
  const [seat] = roster;
  if (!seat) throw new Error("catch-up fixture needs a seated diver");
  return { db, shop, reader, desk, trip, seat };
}

describe("listDeskEventsSince", () => {
  it("tells a first-time reader nothing, however busy the morning was", async () => {
    const { db, shop, reader, desk, trip, seat } = await catchUpFixture();
    for (let index = 0; index < 10; index += 1) {
      await recordDeskEvent(db, {
        shopId: shop.id,
        tripId: trip.id,
        kind: "arrival",
        bookingId: seat.id,
        subjectPersonId: seat.personId,
        actorPersonId: desk.id,
      });
    }

    // No mark means there is nothing to be "since". A first visit is reading,
    // not catching up — and replaying ten acts to somebody who has never
    // opened this departure is the surveillance feed #1202's boundary refuses.
    expect(await listDeskEventsSince(db, shop.id, trip.id, reader.id)).toEqual({
      mark: null,
      events: [],
    });
  });

  it("returns only what happened after the reader last caught up", async () => {
    const { db, shop, reader, desk, trip, seat } = await catchUpFixture();
    await recordDeskEvent(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "arrival",
      bookingId: seat.id,
      subjectPersonId: seat.personId,
      actorPersonId: desk.id,
    });
    await markTripCaughtUp(db, { shopId: shop.id, tripId: trip.id, personId: reader.id });
    await recordDeskEvent(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "gear_changed",
      bookingId: seat.id,
      subjectPersonId: seat.personId,
      actorPersonId: desk.id,
    });

    const after = await listDeskEventsSince(db, shop.id, trip.id, reader.id);
    expect(after.events.map((event) => event.kind)).toEqual(["gear_changed"]);

    // And a second Got it leaves nothing: the strip stops rendering.
    await markTripCaughtUp(db, { shopId: shop.id, tripId: trip.id, personId: reader.id });
    expect((await listDeskEventsSince(db, shop.id, trip.id, reader.id)).events).toEqual([]);
  });

  it("never tells the actor about their own act", async () => {
    const { db, shop, desk, trip, seat } = await catchUpFixture();
    await recordDeskEvent(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "seat_taken",
      bookingId: seat.id,
      subjectPersonId: seat.personId,
      actorPersonId: desk.id,
    });

    // Writing the event advanced the desk's own mark, so they have one — and it
    // is already past the thing they just did.
    const own = await listDeskEventsSince(db, shop.id, trip.id, desk.id);
    expect(own.mark).not.toBeNull();
    expect(own.events).toEqual([]);
  });

  it("carries a diver's act to every staffer, including the desk", async () => {
    const { db, shop, desk, trip, seat } = await catchUpFixture();
    await recordDeskEvent(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "arrival",
      bookingId: seat.id,
      subjectPersonId: seat.personId,
      actorPersonId: desk.id,
    });
    // A help request has no staff actor: the diver asked on their own link.
    await recordDeskEvent(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "help_request",
      bookingId: seat.id,
      subjectPersonId: seat.personId,
    });

    const seen = await listDeskEventsSince(db, shop.id, trip.id, desk.id);
    expect(seen.events.map((event) => event.kind)).toEqual(["help_request"]);
  });

  it("tells another shop's staffer nothing about this departure", async () => {
    const { db, shop, desk, trip, seat } = await catchUpFixture();
    await recordDeskEvent(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "arrival",
      bookingId: seat.id,
      subjectPersonId: seat.personId,
      actorPersonId: desk.id,
    });
    const [otherShop] = await db
      .insert(shops)
      .values({
        name: "Coral Ledge Divers",
        slug: "coral-ledge-desk-events",
        timezone: "America/New_York",
      })
      .returning({ id: shops.id });
    if (!otherShop) throw new Error("test setup: a second shop is required");
    const [stranger] = await db
      .insert(people)
      .values({ shopId: otherShop.id, fullName: "Stranger", email: "stranger@example.invalid" })
      .returning({ id: people.id });
    if (!stranger) throw new Error("test setup: a second shop's staffer is required");

    // Neither the mark nor the events are reachable across the tenant line, and
    // the mark write is refused rather than silently landing.
    expect(await listDeskEventsSince(db, otherShop.id, trip.id, stranger.id)).toEqual({
      mark: null,
      events: [],
    });
    expect(
      await markTripCaughtUp(db, {
        shopId: otherShop.id,
        tripId: trip.id,
        personId: stranger.id,
      }),
    ).toBe(false);
  });

  it("says nothing about a departure that has been taken off the board", async () => {
    const { db, shop, reader, desk, trip, seat } = await catchUpFixture();
    await markTripCaughtUp(db, { shopId: shop.id, tripId: trip.id, personId: reader.id });
    await recordDeskEvent(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "arrival",
      bookingId: seat.id,
      subjectPersonId: seat.personId,
      actorPersonId: desk.id,
    });
    await db
      .update(trips)
      .set({ deletedAt: new Date("2026-07-21T13:00:00.000Z") })
      .where(eq(trips.id, trip.id));

    expect(await listDeskEventsSince(db, shop.id, trip.id, reader.id)).toEqual({
      mark: null,
      events: [],
    });
  });

  it("reads an erased diver's name as the record now stands, not as it was", async () => {
    const { db, shop, reader, desk, trip, seat } = await catchUpFixture();
    await markTripCaughtUp(db, { shopId: shop.id, tripId: trip.id, personId: reader.id });
    await recordDeskEvent(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "arrival",
      bookingId: seat.id,
      subjectPersonId: seat.personId,
      actorPersonId: desk.id,
    });
    const before = await listDeskEventsSince(db, shop.id, trip.id, reader.id);
    expect(before.events[0]?.subjectName).toBeTruthy();

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: seat.personId,
      actorPersonId: reader.id,
    });
    expect(erased.ok).toBe(true);

    // The event row stores an id, never a name, so the strip follows the
    // erasure with no sweep of its own.
    const after = await listDeskEventsSince(db, shop.id, trip.id, reader.id);
    expect(after.events[0]?.subjectName).not.toBe(before.events[0]?.subjectName);
  });
});

/**
 * The demo shop actually opens on a strip with something to say
 * (`src/db/seed-desk-handoff.ts`). Pinned because the whole seed is annotation
 * a reader only notices when it is missing — and because it is what the
 * `manifest` visual baseline photographs.
 */
describe("the seeded morning handoff", () => {
  it("leaves the owner behind on the desk's acts, and two consented welcome cues", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("the seeded demo lost its owner");

    // Found through the mark rather than by picking a trip: the history
    // template back-fills a trailing quarter of already-sailed departures, so
    // "the first trip" is one from three months ago. Exactly one mark is also
    // the assertion — the seed marks one boat, today's.
    const marks = await db
      .select({ tripId: tripReadMarks.tripId, title: trips.title })
      .from(tripReadMarks)
      .innerJoin(trips, eq(trips.id, tripReadMarks.tripId))
      .where(and(eq(tripReadMarks.shopId, shop.id), eq(tripReadMarks.personId, owner.id)));
    expect(marks).toHaveLength(1);
    const reefId = marks[0]?.tripId;
    if (!reefId) throw new Error("the seeded demo left the owner no read mark");
    expect(marks[0]?.title).toContain("Two-Tank Reef");

    const catchUp = await listDeskEventsSince(db, shop.id, reefId, owner.id);
    expect(catchUp.mark).not.toBeNull();
    expect(catchUp.events.length).toBeGreaterThan(0);
    expect(catchUp.events.map((event) => event.kind)).toContain("arrival");

    const consented = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.tripId, reefId), isNotNull(bookings.welcomeSharedAt)));
    expect(consented.length).toBeGreaterThan(0);
  });
});
