import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext, seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { listDeskEventsSince, markTripCaughtUp, recordDeskEvent } from "./desk-events";
import {
  bookings,
  people,
  personRoles,
  shops,
  tripHelpRequests,
  tripReadMarks,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

/**
 * The catch-up strip's reader, against a real database (issues #1202, #1187).
 *
 * The fixture takes the seeded owner as the *reader* and the seeded lead
 * instructor as the *desk* — two different people, because the one thing this
 * reader must never be told about is their own act.
 */
async function catchUpFixture() {
  const { db, shop } = ctx;
  const staff = await db
    .select({ id: people.id, role: personRoles.role, name: people.fullName })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), isNull(people.deletedAt)));
  const reader = staff.find((row) => row.role === "owner");
  const desk = staff.find((row) => row.role === "instructor" && row.id !== reader?.id);
  const [rosterSeat] = await db
    .select({
      id: bookings.id,
      personId: bookings.personId,
      tripId: trips.id,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shop.id),
        eq(trips.shopId, shop.id),
        ne(bookings.status, "cancelled"),
        liveTrip(),
      ),
    )
    .limit(1);
  if (!reader || !desk || !rosterSeat) {
    throw new Error("catch-up fixture needs two staff and a seated diver");
  }
  const { tripId, ...seat } = rosterSeat;
  const trip = { id: tripId };
  return { db, shop, reader, desk, trip, seat };
}

/**
 * A diver's ask for a hand, as `saveHelpRequest` writes it: the request row,
 * and the crew's line with no staff actor. Written here rather than through
 * it because the fixture's departure may already have sailed, which that
 * writer refuses, and what is under test is the reader.
 */
async function askForAHand(
  db: Awaited<ReturnType<typeof catchUpFixture>>["db"],
  input: { shopId: string; tripId: string; bookingId: string; personId: string },
) {
  await db.insert(tripHelpRequests).values({
    shopId: input.shopId,
    tripId: input.tripId,
    bookingId: input.bookingId,
    kind: "carry_gear",
    status: "requested",
  });
  await recordDeskEvent(db, {
    shopId: input.shopId,
    tripId: input.tripId,
    kind: "help_request",
    bookingId: input.bookingId,
    subjectPersonId: input.personId,
  });
}

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

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
    await askForAHand(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: seat.id,
      personId: seat.personId,
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
    if (!stranger) throw new Error("test setup: a second shop’s staffer is required");

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

  it("does not disclose a subject name belonging to another shop", async () => {
    const { db, shop, reader, desk, trip } = await catchUpFixture();
    const [otherShop] = await db
      .insert(shops)
      .values({
        name: "Other shop",
        slug: "other-desk-event-shop",
        timezone: "UTC",
      })
      .returning();
    if (!otherShop) throw new Error("missing other shop");
    const [subject] = await db
      .insert(people)
      .values({
        shopId: otherShop.id,
        fullName: "Other shop person",
      })
      .returning();
    if (!subject) throw new Error("missing other subject");
    await markTripCaughtUp(db, { shopId: shop.id, tripId: trip.id, personId: reader.id });
    await recordDeskEvent(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "gear_changed",
      subjectPersonId: subject.id,
      actorPersonId: desk.id,
    });
    const seen = await listDeskEventsSince(db, shop.id, trip.id, reader.id);
    expect(seen.events).toHaveLength(1);
    expect(seen.events[0]?.subjectName).toBeNull();
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
      kind: "gear_changed",
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
 * **The strip says a roster line only while the roster still says it** (UX
 * review 2026-10-13, item 3): the demo's manifest opened on "Priya Sharma and
 * Tom Okafor have checked in." directly above "0 of 11 people aboard" and
 * Priya's row reading Blocked, because the lines were read from the event log
 * alone.
 */
describe("listDeskEventsSince, against the roster it sits above", () => {
  async function arrivalAfterMark(status: "booked" | "checked_in") {
    const fixture = await catchUpFixture();
    const { db, shop, reader, desk, trip, seat } = fixture;
    await markTripCaughtUp(db, { shopId: shop.id, tripId: trip.id, personId: reader.id });
    await db.update(bookings).set({ status }).where(eq(bookings.id, seat.id));
    await recordDeskEvent(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "arrival",
      bookingId: seat.id,
      subjectPersonId: seat.personId,
      actorPersonId: desk.id,
    });
    return fixture;
  }

  it("says an arrival while the seat is checked in", async () => {
    const { db, shop, reader, trip } = await arrivalAfterMark("checked_in");
    const seen = await listDeskEventsSince(db, shop.id, trip.id, reader.id);
    expect(seen.events.map((event) => event.kind)).toEqual(["arrival"]);
  });

  it("drops an arrival whose check-in was taken back", async () => {
    // `undoCheckInBooking` writes no event (an undo is not news), so the only
    // thing that can retract the line is the seat it names.
    const { db, shop, reader, trip, seat } = await arrivalAfterMark("checked_in");
    await db.update(bookings).set({ status: "booked" }).where(eq(bookings.id, seat.id));
    expect((await listDeskEventsSince(db, shop.id, trip.id, reader.id)).events).toEqual([]);
  });

  it("drops an arrival once the checked-in seat moves to another departure", async () => {
    // Domain review 1: a seat move keeps the status, so the status alone would
    // leave the old strip saying the diver arrived for a boat they are not on.
    const { db, shop, reader, trip, seat } = await arrivalAfterMark("checked_in");
    const [other] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), ne(trips.id, trip.id)))
      .limit(1);
    if (!other) throw new Error("expected a second departure");
    await db.update(bookings).set({ tripId: other.id }).where(eq(bookings.id, seat.id));
    expect((await listDeskEventsSince(db, shop.id, trip.id, reader.id)).events).toEqual([]);
  });

  it("never says an arrival for a seat the counter has not checked in", async () => {
    const { db, shop, reader, trip } = await arrivalAfterMark("booked");
    expect((await listDeskEventsSince(db, shop.id, trip.id, reader.id)).events).toEqual([]);
  });

  it("says a diver's ask for a hand only while it is still open", async () => {
    const { db, shop, reader, trip, seat } = await catchUpFixture();
    await markTripCaughtUp(db, { shopId: shop.id, tripId: trip.id, personId: reader.id });
    await askForAHand(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: seat.id,
      personId: seat.personId,
    });
    const open = await listDeskEventsSince(db, shop.id, trip.id, reader.id);
    expect(open.events.map((event) => event.kind)).toEqual(["help_request"]);

    // Withdrawn on the diver's own link: the line goes with the ask.
    await db
      .update(tripHelpRequests)
      .set({ status: "withdrawn" })
      .where(eq(tripHelpRequests.bookingId, seat.id));
    expect((await listDeskEventsSince(db, shop.id, trip.id, reader.id)).events).toEqual([]);
  });

  it("drops a seat taken once that seat is released, and keeps the release", async () => {
    const { db, shop, reader, desk, trip, seat } = await catchUpFixture();
    await markTripCaughtUp(db, { shopId: shop.id, tripId: trip.id, personId: reader.id });
    for (const kind of ["seat_taken", "seat_released"] as const) {
      await recordDeskEvent(db, {
        shopId: shop.id,
        tripId: trip.id,
        kind,
        bookingId: seat.id,
        subjectPersonId: seat.personId,
        actorPersonId: desk.id,
      });
    }
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, seat.id));
    const seen = await listDeskEventsSince(db, shop.id, trip.id, reader.id);
    expect(seen.events.map((event) => event.kind)).toEqual(["seat_released"]);
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

    // And every line of it is true of the roster under it (UX review
    // 2026-10-13, item 3): each named arrival is a checked-in seat, and the
    // meeting point the strip says moved is one the departure actually has.
    const checkedIn = await db
      .select({ name: people.fullName })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(and(eq(bookings.tripId, reefId), eq(bookings.status, "checked_in")));
    const arrivals = catchUp.events.filter((event) => event.kind === "arrival");
    expect(arrivals.map((event) => event.subjectName).sort()).toEqual(
      checkedIn.map((row) => row.name).sort(),
    );
    const [reef] = await db
      .select({ label: trips.meetingPointLabel })
      .from(trips)
      .where(eq(trips.id, reefId));
    expect(reef?.label).toBeTruthy();

    const consented = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.tripId, reefId), isNotNull(bookings.welcomeSharedAt)));
    expect(consented.length).toBeGreaterThan(0);
  });
});
