import { and, eq, isNotNull, isNull, ne, notExists } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { markArrived } from "@/test/arrivals";
import { fileScopedShopContext, seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { seatCheckedIn } from "./arrival-provenance";
import type { DbExecutor } from "./client";
import { recordActivityRow, recordDeskLine } from "./operations";
import {
  activityEvents,
  bookings,
  people,
  personRoles,
  shops,
  tripHelpRequests,
  tripReadMarks,
  trips,
} from "./schema";
import { listCatchUpSince, markTripCaughtUp } from "./trip-read-marks";
import { liveTrip } from "./trips-live";

/**
 * One desk line of the kind the strip says, written the way its writer
 * writes it (issue #2701): an arrival is the check-in's trail line and a seat
 * taken is seating's, both flagged for the desk; every other kind is a
 * desk-only line.
 */
async function recordLine(
  db: DbExecutor,
  input: {
    shopId: string;
    tripId: string;
    kind:
      | "arrival"
      | "seat_taken"
      | "seat_released"
      | "gear_changed"
      | "help_request"
      | "running_late"
      | "plan_changed";
    bookingId?: string;
    subjectPersonId?: string;
    actorPersonId?: string;
  },
) {
  const { kind, ...line } = input;
  if (kind === "arrival" || kind === "seat_taken") {
    return recordActivityRow(db, {
      ...line,
      code: kind === "arrival" ? "counter_check_in" : "seat_added",
      params: { actor: "Desk", diver: "Diver" },
    });
  }
  await recordDeskLine(db, { ...line, code: `desk_${kind}` });
  return null;
}

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
 * A diver's ask for a hand, as `recordHelpRequest` writes it: the request row,
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
  await recordLine(db, {
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

describe("listCatchUpSince", () => {
  it("tells a first-time reader nothing, however busy the morning was", async () => {
    const { db, shop, reader, desk, trip, seat } = await catchUpFixture();
    for (let index = 0; index < 10; index += 1) {
      await recordLine(db, {
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
    expect(await listCatchUpSince(db, shop.id, trip.id, reader.id)).toEqual({
      mark: null,
      events: [],
    });
  });

  it("returns only what happened after the reader last caught up", async () => {
    const { db, shop, reader, desk, trip, seat } = await catchUpFixture();
    await recordLine(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "arrival",
      bookingId: seat.id,
      subjectPersonId: seat.personId,
      actorPersonId: desk.id,
    });
    await markTripCaughtUp(db, { shopId: shop.id, tripId: trip.id, personId: reader.id });
    await recordLine(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "gear_changed",
      bookingId: seat.id,
      subjectPersonId: seat.personId,
      actorPersonId: desk.id,
    });

    const after = await listCatchUpSince(db, shop.id, trip.id, reader.id);
    expect(after.events.map((event) => event.kind)).toEqual(["gear_changed"]);

    // And a second Got it leaves nothing: the strip stops rendering.
    await markTripCaughtUp(db, { shopId: shop.id, tripId: trip.id, personId: reader.id });
    expect((await listCatchUpSince(db, shop.id, trip.id, reader.id)).events).toEqual([]);
  });

  it("never tells the actor about their own act", async () => {
    const { db, shop, desk, trip, seat } = await catchUpFixture();
    await recordLine(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "seat_taken",
      bookingId: seat.id,
      subjectPersonId: seat.personId,
      actorPersonId: desk.id,
    });

    // Writing the event gave the desk their first mark, at the thing they just
    // did, and the reader leaves out their own lines.
    const own = await listCatchUpSince(db, shop.id, trip.id, desk.id);
    expect(own.mark).not.toBeNull();
    expect(own.events).toEqual([]);
  });

  it("keeps a teammate's earlier line unseen when the reader acts after it (issue #3886)", async () => {
    // Ben (the reader) had read up to here; Ana (the desk) then changes a
    // diver's gear and a diver asks for a hand; then Ben checks in Carlos.
    // Ben's own act must not carry his mark past what he has not read.
    const { db, shop, reader: ben, desk: ana, trip, seat } = await catchUpFixture();
    await markTripCaughtUp(db, { shopId: shop.id, tripId: trip.id, personId: ben.id });
    const before = await listCatchUpSince(db, shop.id, trip.id, ben.id);
    await recordLine(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "gear_changed",
      bookingId: seat.id,
      subjectPersonId: seat.personId,
      actorPersonId: ana.id,
    });
    await askForAHand(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: seat.id,
      personId: seat.personId,
    });
    await recordLine(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "arrival",
      bookingId: seat.id,
      subjectPersonId: seat.personId,
      actorPersonId: ben.id,
    });

    const after = await listCatchUpSince(db, shop.id, trip.id, ben.id);
    expect(after.mark?.seq).toBe(before.mark?.seq);
    expect(after.events.map((event) => event.kind)).toEqual(["gear_changed", "help_request"]);
  });

  it("starts a mark at the first act of someone who never had one", async () => {
    const { db, shop, reader, desk, trip, seat } = await catchUpFixture();
    // Lines before the reader's first act are never "since" anything.
    await recordLine(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "gear_changed",
      bookingId: seat.id,
      subjectPersonId: seat.personId,
      actorPersonId: desk.id,
    });
    const own = await recordLine(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "arrival",
      bookingId: seat.id,
      subjectPersonId: seat.personId,
      actorPersonId: reader.id,
    });
    await recordLine(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "plan_changed",
      actorPersonId: desk.id,
    });

    const seen = await listCatchUpSince(db, shop.id, trip.id, reader.id);
    expect(seen.mark?.seq).toBe(own?.seq);
    expect(seen.events.map((event) => event.kind)).toEqual(["plan_changed"]);
  });

  it("carries a diver's act to every staffer, including the desk", async () => {
    const { db, shop, desk, trip, seat } = await catchUpFixture();
    await recordLine(db, {
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

    const seen = await listCatchUpSince(db, shop.id, trip.id, desk.id);
    expect(seen.events.map((event) => event.kind)).toEqual(["help_request"]);
  });

  it("tells another shop's staffer nothing about this departure", async () => {
    const { db, shop, desk, trip, seat } = await catchUpFixture();
    await recordLine(db, {
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
        slug: "coral-ledge-desk-lines",
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
    expect(await listCatchUpSince(db, otherShop.id, trip.id, stranger.id)).toEqual({
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
        slug: "other-desk-line-shop",
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
    await recordLine(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "gear_changed",
      subjectPersonId: subject.id,
      actorPersonId: desk.id,
    });
    const seen = await listCatchUpSince(db, shop.id, trip.id, reader.id);
    expect(seen.events).toHaveLength(1);
    expect(seen.events[0]?.subjectName).toBeNull();
  });

  it("says nothing about a departure that has been taken off the board", async () => {
    const { db, shop, reader, desk, trip, seat } = await catchUpFixture();
    await markTripCaughtUp(db, { shopId: shop.id, tripId: trip.id, personId: reader.id });
    await recordLine(db, {
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

    expect(await listCatchUpSince(db, shop.id, trip.id, reader.id)).toEqual({
      mark: null,
      events: [],
    });
  });

  it("says nothing about an erased diver: the erasure deletes their desk lines", async () => {
    const { db, shop, reader, desk, trip, seat } = await catchUpFixture();
    await markTripCaughtUp(db, { shopId: shop.id, tripId: trip.id, personId: reader.id });
    await recordLine(db, {
      shopId: shop.id,
      tripId: trip.id,
      kind: "gear_changed",
      bookingId: seat.id,
      subjectPersonId: seat.personId,
      actorPersonId: desk.id,
    });
    const before = await listCatchUpSince(db, shop.id, trip.id, reader.id);
    expect(before.events[0]?.subjectName).toBeTruthy();

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: seat.personId,
      actorPersonId: reader.id,
    });
    expect(erased.ok).toBe(true);

    // A desk-only line is a handoff, not history: the erasure deletes it
    // rather than leaving a `[redacted]` line on the trail (issue #2701).
    const after = await listCatchUpSince(db, shop.id, trip.id, reader.id);
    expect(after.events).toEqual([]);
    const left = await db
      .select({ id: activityEvents.id })
      .from(activityEvents)
      .where(and(eq(activityEvents.shopId, shop.id), eq(activityEvents.code, "desk_gear_changed")));
    expect(left).toEqual([]);
  });
});

/**
 * **The strip is exactly the desk lines after the mark** (issue #2701): the
 * trail and the desk now share one table, so a trail line the desk does not
 * flag, a line before the mark, and a line on another departure must all stay
 * off it, and every desk line after it must be on it.
 */
describe("listCatchUpSince, over the shared trail", () => {
  it("returns every desk-flagged line after the mark and nothing else", async () => {
    const { db, shop, reader, desk, trip, seat } = await catchUpFixture();
    const line = { shopId: shop.id, tripId: trip.id, bookingId: seat.id };
    // Before the mark: a desk line the reader has already seen.
    await recordDeskLine(db, {
      ...line,
      code: "desk_pickup_set",
      subjectPersonId: seat.personId,
      actorPersonId: desk.id,
    });
    await markTripCaughtUp(db, { shopId: shop.id, tripId: trip.id, personId: reader.id });
    // After it: staff trail lines the desk does not flag, which the strip must
    // never say — a private note, a medical read, a no-show.
    for (const code of ["note_added", "booking_no_show", "medical_answers_read"] as const) {
      await recordActivityRow(db, {
        ...line,
        code,
        actorPersonId: desk.id,
        subjectPersonId: seat.personId,
        params: { actor: "Desk", diver: "Diver" },
      });
    }
    // ...and the desk lines it must say: one desk-only, one flagged trail code.
    await recordDeskLine(db, {
      ...line,
      code: "desk_gear_changed",
      subjectPersonId: seat.personId,
      actorPersonId: desk.id,
    });
    await recordActivityRow(db, {
      ...line,
      code: "participant_type_changed",
      actorPersonId: desk.id,
      subjectPersonId: seat.personId,
      params: {
        actor: "Desk",
        diver: "Diver",
        from: "diver",
        type: "snorkeler",
        certCheck: "none",
        cleared: "",
        atSea: "no",
      },
    });
    await recordDeskLine(db, { shopId: shop.id, tripId: trip.id, code: "desk_plan_changed" });

    const seen = await listCatchUpSince(db, shop.id, trip.id, reader.id);
    expect(seen.events.map((event) => event.kind)).toEqual([
      "gear_changed",
      "now_snorkeling",
      "plan_changed",
    ]);
  });

  it("says nothing for a seat moved away after the desk turned it away", async () => {
    const { db, shop, reader, desk, trip, seat } = await catchUpFixture();
    await markTripCaughtUp(db, { shopId: shop.id, tripId: trip.id, personId: reader.id });
    for (const turnedAway of [true, false]) {
      await recordActivityRow(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: seat.id,
        subjectPersonId: seat.personId,
        actorPersonId: desk.id,
        code: "seat_moved_away",
        params: { actor: "Desk", diver: "Diver", ...(turnedAway ? { turnedAway: "yes" } : {}) },
      });
    }
    const seen = await listCatchUpSince(db, shop.id, trip.id, reader.id);
    expect(seen.events.map((event) => event.kind)).toEqual(["seat_released"]);
  });

  it("refuses a desk-only line addressed to divers", async () => {
    // The #1202 boundary, held by the table itself: no writer can file a
    // desk line where a diver-facing reader would find it.
    const { db, shop, desk, trip, seat } = await catchUpFixture();
    await expect(
      db.insert(activityEvents).values({
        shopId: shop.id,
        tripId: trip.id,
        bookingId: seat.id,
        subjectPersonId: seat.personId,
        actorPersonId: desk.id,
        code: "desk_help_request",
        audience: "diver",
      }),
    ).rejects.toThrow();
  });

  it("refuses a trail line with neither an actor nor a system reason", async () => {
    // The desk-only exemption is for desk-only codes; the trail keeps its rule.
    const { db, shop, trip } = await catchUpFixture();
    await expect(
      db.insert(activityEvents).values({ shopId: shop.id, tripId: trip.id, code: "seat_added" }),
    ).rejects.toThrow();
  });
});

/**
 * **The strip says a roster line only while the roster still says it** (UX
 * review 2026-10-13, item 3): the demo's manifest opened on "Priya Sharma and
 * Tom Okafor have checked in." directly above "0 of 11 people aboard" and
 * Priya's row reading Blocked, because the lines were read from the event log
 * alone.
 */
describe("listCatchUpSince, against the roster it sits above", () => {
  async function arrivalAfterMark(checkedIn = true) {
    const fixture = await catchUpFixture();
    const { db, shop, reader, desk, trip, seat } = fixture;
    await markTripCaughtUp(db, { shopId: shop.id, tripId: trip.id, personId: reader.id });
    // Checked in is the arrival trail, not a seat status (issue #2702).
    if (checkedIn) await markArrived(db, seat.id, { recordedByPersonId: desk.id });
    await recordLine(db, {
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
    const { db, shop, reader, trip } = await arrivalAfterMark();
    const seen = await listCatchUpSince(db, shop.id, trip.id, reader.id);
    expect(seen.events.map((event) => event.kind)).toEqual(["arrival"]);
  });

  it("drops an arrival whose check-in was taken back", async () => {
    // `undoCheckInBooking` writes no event (an undo is not news), so the only
    // thing that can retract the line is the seat it names.
    const { db, shop, reader, trip, seat, desk } = await arrivalAfterMark();
    // The undo's `cleared` row on the trail, which is all an undo writes now.
    await markArrived(db, seat.id, { recordedByPersonId: desk.id, status: "cleared" });
    expect((await listCatchUpSince(db, shop.id, trip.id, reader.id)).events).toEqual([]);
  });

  it("drops an arrival once the checked-in seat moves to another departure", async () => {
    // Domain review 1: a seat move keeps the status, so the status alone would
    // leave the old strip saying the diver arrived for a boat they are not on.
    const { db, shop, reader, trip, seat } = await arrivalAfterMark();
    const [other] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(
          eq(trips.shopId, shop.id),
          ne(trips.id, trip.id),
          eq(trips.status, "scheduled"),
          liveTrip(),
          notExists(
            db
              .select({ id: bookings.id })
              .from(bookings)
              .where(and(eq(bookings.tripId, trips.id), eq(bookings.personId, seat.personId))),
          ),
        ),
      )
      .limit(1);
    if (!other) throw new Error("expected a second departure");
    await db.update(bookings).set({ tripId: other.id }).where(eq(bookings.id, seat.id));
    expect((await listCatchUpSince(db, shop.id, trip.id, reader.id)).events).toEqual([]);
  });

  it("never says an arrival for a seat the counter has not checked in", async () => {
    const { db, shop, reader, trip } = await arrivalAfterMark(false);
    expect((await listCatchUpSince(db, shop.id, trip.id, reader.id)).events).toEqual([]);
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
    const open = await listCatchUpSince(db, shop.id, trip.id, reader.id);
    expect(open.events.map((event) => event.kind)).toEqual(["help_request"]);

    // Withdrawn on the diver's own link: the line goes with the ask.
    await db
      .update(tripHelpRequests)
      .set({ status: "withdrawn" })
      .where(eq(tripHelpRequests.bookingId, seat.id));
    expect((await listCatchUpSince(db, shop.id, trip.id, reader.id)).events).toEqual([]);
  });

  it("drops a seat taken once that seat is released, and keeps the release", async () => {
    const { db, shop, reader, desk, trip, seat } = await catchUpFixture();
    await markTripCaughtUp(db, { shopId: shop.id, tripId: trip.id, personId: reader.id });
    for (const kind of ["seat_taken", "seat_released"] as const) {
      await recordLine(db, {
        shopId: shop.id,
        tripId: trip.id,
        kind,
        bookingId: seat.id,
        subjectPersonId: seat.personId,
        actorPersonId: desk.id,
      });
    }
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, seat.id));
    const seen = await listCatchUpSince(db, shop.id, trip.id, reader.id);
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

    const catchUp = await listCatchUpSince(db, shop.id, reefId, owner.id);
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
      .where(and(eq(bookings.tripId, reefId), seatCheckedIn));
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
