// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import * as bookingCapabilitiesModule from "./booking-capabilities";
import {
  cancelBooking,
  confirmBookingIdentity,
  createBooking,
  createBookingParty,
  rescheduleBooking,
  restoreBooking,
  selfCancelBooking,
} from "./bookings";
import type { AppDb } from "./client";
import { createDiver } from "./divers";
import { setBookingPayment } from "./payments";
import {
  bookingCapabilities,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookings,
  courses,
  people,
  personRoles,
  shops,
  tripAssignments,
  trips,
} from "./schema";
import {
  changeTripCrew,
  createTrip,
  getTripRoster,
  listStaff,
  setTripCrew,
  setTripStatus,
  upcomingTripsWithCounts,
} from "./trips";

async function seededContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  const fullTrip = trips.find((t) => t.title === "Wreck Trip — Spiegel Grove");
  if (!open || !fullTrip) throw new Error("expected seeded trips missing");
  return { db, shop, open, fullTrip };
}

const visitor = { fullName: "Nora Quinn", email: "nora@example.com", phone: "+1-305-555-0199" };

async function bookVisitor(db: AppDb, shopId: string, tripId: string) {
  return createBooking(db, { actor: "staff", shopId, tripId, ...visitor });
}

describe("createBooking (in-memory PGlite)", () => {
  it("books a new visitor, creating a person with the diver role", async () => {
    const { db, shop, open } = await seededContext();
    const outcome = await bookVisitor(db, shop.id, open.id);
    expect(outcome).toMatchObject({ ok: true, personName: "Nora Quinn" });

    const roster = await getTripRoster(db, shop.id, open.id);
    expect(roster.map((r) => r.person.fullName)).toContain("Nora Quinn");

    const [person] = await db
      .select()
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, visitor.email)));
    if (!person) throw new Error("person not created");
    const roles = await db.select().from(personRoles).where(eq(personRoles.personId, person.id));
    expect(roles.map((r) => r.role)).toContain("diver");
  });

  it("dedupes the person by email across trips", async () => {
    const { db, shop, open } = await seededContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const night = trips.find((t) => t.title.startsWith("Night Dive"));
    if (!night) throw new Error("night trip missing");

    await bookVisitor(db, shop.id, open.id);
    const second = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: night.id,
      fullName: "NORA QUINN",
      email: "Nora@Example.com", // different case, same human
    });
    expect(second.ok).toBe(true);

    const matches = await db
      .select()
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, visitor.email)));
    expect(matches).toHaveLength(1);
  });

  it("books a counter walk-in with no email on file, never deduping two of them together", async () => {
    const { db, shop, open } = await seededContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const night = trips.find((t) => t.title.startsWith("Night Dive"));
    if (!night) throw new Error("night trip missing");

    const first = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: open.id,
      fullName: "Walk-in Diver",
    });
    expect(first).toMatchObject({ ok: true, personName: "Walk-in Diver" });

    // A second walk-in booked under the exact same name, still no email — with
    // nothing to dedup against, this must never collapse onto the first
    // person's row (that would attach a stranger's booking to their history).
    const second = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: night.id,
      fullName: "Walk-in Diver",
    });
    expect(second).toMatchObject({ ok: true, personName: "Walk-in Diver" });
    if (!first.ok || !second.ok) throw new Error("expected both bookings to succeed");

    const rows = await db
      .select()
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Walk-in Diver")));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.email === null)).toBe(true);

    const roster = await getTripRoster(db, shop.id, open.id);
    const walkIn = roster.find((r) => r.person.fullName === "Walk-in Diver");
    if (!walkIn) throw new Error("walk-in not on roster");
    const roles = await db
      .select()
      .from(personRoles)
      .where(eq(personRoles.personId, walkIn.person.id));
    expect(roles.map((r) => r.role)).toContain("diver");
  });

  it("rejects a full trip", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const outcome = await bookVisitor(db, shop.id, fullTrip.id);
    expect(outcome).toEqual({ ok: false, reason: "trip_full" });
  });

  it("rejects new bookings while the crew has a conditions hold in place", async () => {
    const { db, shop, open } = await seededContext();
    await db.update(trips).set({ conditionsHold: true }).where(eq(trips.id, open.id));

    expect(await bookVisitor(db, shop.id, open.id)).toEqual({
      ok: false,
      reason: "trip_unavailable",
    });
  });

  it("books multiple named divers together", async () => {
    const { db, shop, open } = await seededContext();
    const outcome = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: open.id,
        fullName: "Nora Quinn",
        email: "nora@example.com",
      },
      {
        actor: "staff",
        shopId: shop.id,
        tripId: open.id,
        fullName: "Sam Quinn",
        email: "sam@example.com",
      },
    ]);
    expect(outcome.ok).toBe(true);
    const roster = await getTripRoster(db, shop.id, open.id);
    expect(roster.map((row) => row.person.fullName)).toEqual(
      expect.arrayContaining(["Nora Quinn", "Sam Quinn"]),
    );
  });

  it("keeps a diver's optional buddy-group preference with the booking", async () => {
    const { db, shop, open } = await seededContext();
    const outcome = await createBooking(db, {
      actor: "public",
      shopId: shop.id,
      tripId: open.id,
      fullName: "Mae Current",
      email: "mae-current@example.com",
      groupPreference: "Slow pace and macro photography",
    });
    if (!outcome.ok) throw new Error("setup booking failed");
    const roster = await getTripRoster(db, shop.id, open.id);
    expect(
      roster.find(({ booking }) => booking.id === outcome.bookingId)?.booking.groupPreference,
    ).toBe("Slow pace and macro photography");
  });

  it("rejects booking the same trip twice", async () => {
    const { db, shop, open } = await seededContext();
    await bookVisitor(db, shop.id, open.id);
    const again = await bookVisitor(db, shop.id, open.id);
    expect(again).toEqual({ ok: false, reason: "already_booked" });
  });

  it("re-activates a cancelled booking instead of failing", async () => {
    const { db, shop, open } = await seededContext();
    const first = await bookVisitor(db, shop.id, open.id);
    if (!first.ok) throw new Error("setup booking failed");

    const { bookings } = await import("./schema");
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, first.bookingId));

    const rebook = await bookVisitor(db, shop.id, open.id);
    expect(rebook).toMatchObject({ ok: true, bookingId: first.bookingId });
  });

  it("rolls back the whole party when a later member can't book", async () => {
    const { db, shop, open } = await seededContext();
    const before = (await getTripRoster(db, shop.id, open.id)).length;
    const outcome = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: open.id,
        fullName: "Nora Quinn",
        email: "nora@example.com",
      },
      // Same email as the first member → already_booked, so the first
      // member's insert must roll back too (all-or-nothing reservation).
      {
        actor: "staff",
        shopId: shop.id,
        tripId: open.id,
        fullName: "Nora Quinn",
        email: "nora@example.com",
      },
    ]);
    // failedIndex: 1 — the second member is the one whose insert collided
    // (task 25), so a caller can highlight *that* fieldset rather than a
    // generic banner that reads as if the first diver were the problem.
    expect(outcome).toEqual({ ok: false, reason: "already_booked", failedIndex: 1 });
    expect(await getTripRoster(db, shop.id, open.id)).toHaveLength(before);
  });

  it("books several party members with no email each without colliding (task 21)", async () => {
    // Priya's kids: two more divers who left email to their parent's contact
    // (BookingPartyFields.tsx's "use the main contact's email" checkbox
    // submits nothing for that field) must not be treated as a duplicate of
    // each other, or of the lead — each gets its own person row, matching the
    // existing no-email walk-in path (`createDiver`/counter booking).
    const { db, shop, open } = await seededContext();
    const outcome = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: open.id,
        fullName: "Priya Shah",
        email: "priya@example.com",
      },
      { actor: "public", shopId: shop.id, tripId: open.id, fullName: "Kid One" },
      { actor: "public", shopId: shop.id, tripId: open.id, fullName: "Kid Two" },
    ]);
    expect(outcome.ok).toBe(true);
    const roster = await getTripRoster(db, shop.id, open.id);
    const names = roster.map((row) => row.person.fullName);
    expect(names).toEqual(expect.arrayContaining(["Priya Shah", "Kid One", "Kid Two"]));
    const kids = roster.filter((row) => row.person.fullName.startsWith("Kid"));
    expect(kids.every((row) => row.person.email === null)).toBe(true);
    // Two distinct person rows, not one reused for both kids.
    expect(new Set(kids.map((row) => row.person.id)).size).toBe(2);
  });

  it("does not attach a booking to a soft-deleted person", async () => {
    const { db, shop, open } = await seededContext();
    const first = await bookVisitor(db, shop.id, open.id);
    if (!first.ok) throw new Error("setup booking failed");
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, first.bookingId));
    await db
      .update(people)
      .set({ deletedAt: nowDate() })
      .where(and(eq(people.shopId, shop.id), eq(people.email, visitor.email)));

    // The deleted record's email is free (matching createDiver): the rebooking
    // diver gets a fresh, roster-visible person, not a booking pinned to a
    // record staff can no longer see.
    const rebook = await bookVisitor(db, shop.id, open.id);
    expect(rebook.ok).toBe(true);
    if (!rebook.ok) return;
    expect(rebook.bookingId).not.toBe(first.bookingId);
    const matches = await db
      .select()
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, visitor.email)));
    expect(matches).toHaveLength(2);
    expect(matches.filter((p) => p.deletedAt === null)).toHaveLength(1);
  });

  it("rejects unknown and cancelled trips", async () => {
    const { db, shop, open } = await seededContext();
    const unknown = await bookVisitor(db, shop.id, "00000000-0000-4000-8000-000000000000");
    expect(unknown).toEqual({ ok: false, reason: "trip_unavailable" });

    const { setTripStatus } = await import("./trips");
    await setTripStatus(db, shop.id, open.id, "cancelled");
    const onCancelled = await bookVisitor(db, shop.id, open.id);
    expect(onCancelled).toEqual({ ok: false, reason: "trip_unavailable" });
  });

  it("rejects a trip that has already departed", async () => {
    // A stale schedule tab, a slow form post, a bookmarked booking URL — the
    // seat has to be refused once the boat has left, and refused with the same
    // word as every other "this trip isn't selling seats" state, so no caller
    // has to distinguish sailed from cancelled to say something honest.
    const { db, shop, open } = await seededContext();
    const departed = new Date(nowDate().getTime() - 2 * 60 * 60 * 1000);
    await db
      .update(trips)
      .set({ startsAt: departed, endsAt: new Date(departed.getTime() + 60 * 60 * 1000) })
      .where(eq(trips.id, open.id));

    expect(await bookVisitor(db, shop.id, open.id)).toEqual({
      ok: false,
      reason: "trip_unavailable",
    });
    expect(await getTripRoster(db, shop.id, open.id)).not.toContainEqual(
      expect.objectContaining({ person: expect.objectContaining({ fullName: visitor.fullName }) }),
    );
  });

  /**
   * Cross-tenant: the shop id and the trip id arrive from different places (a
   * session and a URL), so a copied or guessed trip id from a *real* rival
   * shop is the adversarial case — a nonexistent id proves nothing, because
   * the row simply isn't there. `createBookingRecord` matches on both columns
   * at once, so the rival's genuinely-bookable departure reads as no trip at
   * all from this shop, and the refusal never says "wrong shop" either: a
   * distinguishable answer would confirm the trip exists somewhere.
   */
  async function rivalShopWithOpenTrip(db: AppDb) {
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-reef-bookings", timezone: "America/New_York" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");
    const startsAt = new Date(nowDate().getTime() + 30 * 24 * 60 * 60 * 1000);
    const trip = await createTrip(db, {
      shopId: rival.id,
      title: "Rival Reef — two-tank",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
    });
    if (!trip) throw new Error("rival trip insert failed");
    return { rival, trip };
  }

  it("never books one shop's diver into another shop's real, open trip", async () => {
    const { db, shop } = await seededContext();
    const { rival, trip } = await rivalShopWithOpenTrip(db);
    const before = await db.select({ id: bookings.id }).from(bookings);

    expect(await bookVisitor(db, shop.id, trip.id)).toEqual({
      ok: false,
      reason: "trip_unavailable",
    });

    // Nothing landed anywhere — not on the rival's roster under this shop's
    // id, and not on this shop's books either.
    const after = await db.select({ id: bookings.id }).from(bookings);
    expect(after).toHaveLength(before.length);
    expect(await getTripRoster(db, rival.id, trip.id)).toHaveLength(0);
  });

  it("rolls a party booking back whole when a later member names another shop's trip", async () => {
    const { db, shop, open } = await seededContext();
    const { rival, trip } = await rivalShopWithOpenTrip(db);
    const beforeBookings = await db.select({ id: bookings.id }).from(bookings);
    const beforePeople = await db.select({ id: people.id }).from(people);

    // The first member is a perfectly good booking on this shop's own trip —
    // so there is real written work for the rollback to undo when the second
    // member's trip id turns out to belong to someone else. failedIndex 1
    // points at the fieldset that actually broke.
    expect(
      await createBookingParty(db, [
        {
          actor: "public",
          shopId: shop.id,
          tripId: open.id,
          fullName: "Nora Quinn",
          email: "nora@example.com",
        },
        {
          actor: "public",
          shopId: shop.id,
          tripId: trip.id,
          fullName: "Sam Quinn",
          email: "sam@example.com",
        },
      ]),
    ).toEqual({ ok: false, reason: "trip_unavailable", failedIndex: 1 });

    // All of it, or none of it: the first member's booking *and* the person
    // row minted for them are gone, and the rival's roster never saw anyone.
    expect(await db.select({ id: bookings.id }).from(bookings)).toHaveLength(beforeBookings.length);
    expect(await db.select({ id: people.id }).from(people)).toHaveLength(beforePeople.length);
    expect((await getTripRoster(db, shop.id, open.id)).map((r) => r.person.fullName)).not.toContain(
      "Nora Quinn",
    );
    expect(await getTripRoster(db, rival.id, trip.id)).toHaveLength(0);
  });
});

describe("createBooking by identity (returning diver, no re-entry)", () => {
  async function seedDiver(db: AppDb, shopId: string) {
    const diver = await createDiver(db, {
      shopId,
      fullName: "Rey Marlin",
      email: "rey@example.com",
    });
    if (!diver) throw new Error("diver setup failed");
    return diver;
  }

  it("books an existing person by id and reuses the one row", async () => {
    const { db, shop, open } = await seededContext();
    const diver = await seedDiver(db, shop.id);
    const outcome = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: open.id,
      personId: diver.id,
    });
    expect(outcome).toMatchObject({ ok: true, personName: "Rey Marlin" });

    const roster = await getTripRoster(db, shop.id, open.id);
    expect(roster.map((r) => r.person.id)).toContain(diver.id);
    // The whole point of the picker: no second person is minted.
    const matches = await db
      .select()
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, "rey@example.com")));
    expect(matches).toHaveLength(1);
  });

  it("rejects an unknown person id", async () => {
    const { db, shop, open } = await seededContext();
    const outcome = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: open.id,
      personId: "00000000-0000-4000-8000-000000000000",
    });
    expect(outcome).toEqual({ ok: false, reason: "person_not_found" });
  });

  it("refuses a soft-deleted person (invisible on the roster)", async () => {
    const { db, shop, open } = await seededContext();
    const diver = await seedDiver(db, shop.id);
    await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, diver.id));
    const outcome = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: open.id,
      personId: diver.id,
    });
    expect(outcome).toEqual({ ok: false, reason: "person_not_found" });
  });

  it("rejects re-booking the same trip by identity", async () => {
    const { db, shop, open } = await seededContext();
    const diver = await seedDiver(db, shop.id);
    await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: open.id,
      personId: diver.id,
    });
    const again = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: open.id,
      personId: diver.id,
    });
    expect(again).toEqual({ ok: false, reason: "already_booked" });
  });

  it("rejects a full trip by identity", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const diver = await seedDiver(db, shop.id);
    const outcome = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: fullTrip.id,
      personId: diver.id,
    });
    expect(outcome).toEqual({ ok: false, reason: "trip_full" });
  });
});

describe("restoreBooking (undo of a roster removal)", () => {
  it("restores a cancelled booking while the seat is still free", async () => {
    const { db, shop, open } = await seededContext();
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");
    await cancelBooking(db, shop.id, booked.bookingId);

    expect(await restoreBooking(db, shop.id, booked.bookingId)).toBe("restored");
    const roster = await getTripRoster(db, shop.id, open.id);
    expect(roster.map((r) => r.person.fullName)).toContain("Nora Quinn");
  });

  it("refuses to restore into a boat that has refilled", async () => {
    const { db, shop, open } = await seededContext();
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");
    await cancelBooking(db, shop.id, booked.bookingId);

    // Fill every remaining seat while the removal is undone-able.
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips.find((t) => t.id === open.id);
    if (!trip) throw new Error("trip missing");
    for (let seat = trip.booked; seat < trip.capacity; seat++) {
      const fill = await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: open.id,
        fullName: `Fill Seat ${seat}`,
        email: `fill-${seat}@example.com`,
      });
      if (!fill.ok) throw new Error("seat fill failed");
    }

    expect(await restoreBooking(db, shop.id, booked.bookingId)).toBe("trip_full");
    const roster = await getTripRoster(db, shop.id, open.id);
    expect(roster.map((r) => r.person.fullName)).not.toContain("Nora Quinn");
  });

  it("never clobbers a booking that isn't cancelled", async () => {
    const { db, shop, open } = await seededContext();
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");
    await db
      .update(bookings)
      .set({ status: "checked_in" })
      .where(eq(bookings.id, booked.bookingId));

    expect(await restoreBooking(db, shop.id, booked.bookingId)).toBe("already_active");
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booked.bookingId));
    expect(row?.status).toBe("checked_in");
  });

  it("scopes to the shop and reports unknown bookings", async () => {
    const { db, shop } = await seededContext();
    expect(await restoreBooking(db, shop.id, "00000000-0000-4000-8000-000000000000")).toBe(
      "not_found",
    );
  });

  /**
   * Undo is a seat-granting write, so it answers to the course ratio as well as
   * the boat's capacity (DOM-H2). A two-seat intro session (PADI's Instructor
   * Manual DSD open-water figure, HD-6) with a walk-up in the freed seat is one
   * tap from three uncertified first-timers on one instructor — and the trip's
   * own capacity (12) never notices.
   *
   * 180 days out for the same reason as `src/db/courses.test.ts`: clear of the
   * seeded instructor's calendar, whatever hour the suite runs at.
   */
  const INTRO_SESSION_OFFSET_MS = 180 * 24 * 60 * 60 * 1000;

  async function introSession(db: AppDb, shopId: string) {
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shopId), eq(courses.title, "Discover Scuba Diving")));
    if (!course) throw new Error("Discover Scuba Diving course missing");
    const staff = await listStaff(db, shopId);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!instructor) throw new Error("seeded instructor missing");
    const trip = await createTrip(db, {
      shopId,
      courseId: course.id,
      title: "Discover Scuba — restore test",
      startsAt: new Date(nowMs() + INTRO_SESSION_OFFSET_MS),
      endsAt: new Date(nowMs() + INTRO_SESSION_OFFSET_MS + 4 * 60 * 60 * 1000),
      // Capacity 12 is well clear of the 2:1 ratio cap, so nothing but the
      // ratio can refuse anything here.
      capacity: 12,
      plannedDives: 2,
    });
    if (!trip) throw new Error("failed to create intro test trip");
    if (!(await setTripCrew(db, shopId, trip.id, [instructor.person.id]))) {
      throw new Error("failed to assign instructor");
    }
    return trip;
  }

  /**
   * DOM-M3. Roles were shop-wide only, so the crew list said who was aboard and
   * never what they were doing there: an instructor rostered as this trip's
   * deck hand still counted as the session's instructor and cleared
   * `course_unstaffed` on his own, and a divemaster rostered as the captain
   * still bought two students' worth of ratio capacity. The one definition is
   * `countInWaterCrew` (src/lib/crew-roles.ts); this is it reaching the gate
   * that actually refuses a seat.
   */
  describe("a per-trip role decides who counts toward the ratio", () => {
    async function bookOne(db: AppDb, shopId: string, tripId: string, name: string) {
      return createBooking(db, {
        actor: "staff",
        shopId,
        tripId,
        fullName: name,
        email: `${name.toLowerCase().replace(/\W+/g, "-")}@example.com`,
      });
    }

    it("does not let an instructor rostered as deck crew staff the session", async () => {
      const { db, shop } = await seededContext();
      const trip = await introSession(db, shop.id);
      const staff = await listStaff(db, shop.id);
      const instructor = staff.find((entry) => entry.roles.includes("instructor"));
      if (!instructor) throw new Error("seeded instructor missing");

      // Written straight to the row rather than through `setTripCrew`, which
      // now refuses this very edit (see the symmetry test below). The booking
      // gate still has to read such a row correctly: it can arrive from an
      // import, from a qualification revoked after the roster was set, or from
      // any future writer. Same person, same qualification, same assignment
      // row — only the job they are rostered to do differs.
      // `introSession` already rostered him, so this only rewrites the job on
      // the existing row — a `setTripCrew` call here would carry the previous
      // role forward and refuse the very edit being set up.
      const rosterAs = async (tripRole: "instructor" | "divemaster" | "captain" | "crew" | null) =>
        db
          .update(tripAssignments)
          .set({ tripRole })
          .where(
            and(
              eq(tripAssignments.tripId, trip.id),
              eq(tripAssignments.personId, instructor.person.id),
            ),
          );

      await rosterAs("crew");
      await expect(bookOne(db, shop.id, trip.id, "Ratio Role Diver A")).resolves.toMatchObject({
        ok: false,
        reason: "course_unstaffed",
      });

      // Rostered as the instructor: the session is staffed and seats open.
      await rosterAs("instructor");
      await expect(bookOne(db, shop.id, trip.id, "Ratio Role Diver B")).resolves.toMatchObject({
        ok: true,
      });

      // And an unspecified role is the status quo — exactly what every row
      // written before the column existed carries, and it must keep behaving
      // the way it always did.
      await rosterAs(null);
      await expect(bookOne(db, shop.id, trip.id, "Ratio Role Diver C")).resolves.toMatchObject({
        ok: true,
      });
    });

    /**
     * Review 20260803, D8. Both crew write paths refuse to leave a course
     * session with no instructor — and "no instructor" is `countInWaterCrew`,
     * the one definition, not a scan of `person_roles`. Before this,
     * `setTripCrew` refused to *unassign* the session's last instructor but
     * happily rostered the same person onto the deck, which says exactly the
     * same thing about the session and left it unstaffed by a different route.
     */
    it("refuses to roster the last instructor off the ratio, as it refuses to remove them", async () => {
      const { db, shop } = await seededContext();
      const trip = await introSession(db, shop.id);
      const staff = await listStaff(db, shop.id);
      const instructor = staff.find((entry) => entry.roles.includes("instructor"));
      if (!instructor) throw new Error("seeded instructor missing");

      for (const tripRole of ["crew", "captain"] as const) {
        expect(
          await setTripCrew(db, shop.id, trip.id, [{ personId: instructor.person.id, tripRole }]),
        ).toBe(false);
        expect(
          await changeTripCrew(db, shop.id, trip.id, {
            personId: instructor.person.id,
            operation: "assign",
            tripRole,
          }),
        ).toBe(false);
      }
      // Refused, not half-applied: the session is still staffed and still sells.
      await expect(bookOne(db, shop.id, trip.id, "Ratio Symmetry Diver")).resolves.toMatchObject({
        ok: true,
      });
      // Rostering someone onto the deck is fine once somebody else is teaching.
      const second = staff.find(
        (entry) => entry.roles.includes("instructor") && entry.person.id !== instructor.person.id,
      );
      if (second) {
        expect(
          await setTripCrew(db, shop.id, trip.id, [
            { personId: second.person.id, tripRole: "instructor" },
            { personId: instructor.person.id, tripRole: "crew" },
          ]),
        ).toBe(true);
      }
    });

    it("stops a divemaster rostered as captain from raising the seat cap", async () => {
      const { db, shop } = await seededContext();
      const [course] = await db
        .select()
        .from(courses)
        .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Open Water Diver")));
      if (!course) throw new Error("Open Water Diver course missing");
      const staff = await listStaff(db, shop.id);
      const instructor = staff.find((entry) => entry.roles.includes("instructor"));
      const divemaster = staff.find(
        (entry) => entry.roles.includes("divemaster") && !entry.roles.includes("instructor"),
      );
      if (!instructor || !divemaster) throw new Error("seeded crew missing");

      // Entry-level ratio: 8 students per instructor, +2 per certified
      // assistant. Capacity 12 so only the ratio can refuse anything.
      const trip = await createTrip(db, {
        shopId: shop.id,
        courseId: course.id,
        title: "Open Water — per-trip role test",
        startsAt: new Date(nowMs() + INTRO_SESSION_OFFSET_MS + 60 * 60 * 1000),
        endsAt: new Date(nowMs() + INTRO_SESSION_OFFSET_MS + 5 * 60 * 60 * 1000),
        capacity: 12,
        plannedDives: 2,
      });
      if (!trip) throw new Error("failed to create course trip");
      expect(
        await setTripCrew(db, shop.id, trip.id, [
          { personId: instructor.person.id, tripRole: "instructor" },
          { personId: divemaster.person.id, tripRole: "divemaster" },
        ]),
      ).toBe(true);

      // 8 base + 2 for the assistant = 10 seats. Fill 9 of them.
      for (let i = 0; i < 9; i += 1) {
        await expect(bookOne(db, shop.id, trip.id, `OW Ratio Diver ${i}`)).resolves.toMatchObject({
          ok: true,
        });
      }

      // Move the divemaster to the helm. She is still aboard and still a
      // divemaster — she is just not supervising anybody in the water, so the
      // cap drops back to 8 and the boat is already over it.
      expect(
        await changeTripCrew(db, shop.id, trip.id, {
          personId: divemaster.person.id,
          operation: "assign",
          tripRole: "captain",
        }),
      ).toBe(true);
      await expect(bookOne(db, shop.id, trip.id, "OW Ratio Diver 9")).resolves.toMatchObject({
        ok: false,
        reason: "course_ratio_full",
      });

      // Hand her back to the water and the tenth seat exists again.
      expect(
        await changeTripCrew(db, shop.id, trip.id, {
          personId: divemaster.person.id,
          operation: "assign",
          tripRole: "divemaster",
        }),
      ).toBe(true);
      await expect(bookOne(db, shop.id, trip.id, "OW Ratio Diver 10")).resolves.toMatchObject({
        ok: true,
      });
    });
  });

  it("refuses an undo that would put a third diver on a two-seat intro session", async () => {
    const { db, shop } = await seededContext();
    const trip = await introSession(db, shop.id);
    const seated = [];
    for (let i = 0; i < 2; i++) {
      const outcome = await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: `DSD Restore Diver ${i}`,
        email: `dsd-restore-${i}@example.com`,
      });
      if (!outcome.ok) throw new Error("setup booking failed");
      seated.push(outcome.bookingId);
    }
    const removed = seated[0];
    if (!removed) throw new Error("no booking to remove");
    await cancelBooking(db, shop.id, removed);

    // A walk-up takes the freed seat — legitimately, the session is back at 2.
    const walkUp = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "DSD Walk Up",
      email: "dsd-walk-up@example.com",
    });
    expect(walkUp).toMatchObject({ ok: true });

    expect(await restoreBooking(db, shop.id, removed)).toBe("course_ratio_full");
    const roster = await getTripRoster(db, shop.id, trip.id);
    expect(roster).toHaveLength(2);
    expect(roster.map((r) => r.person.fullName)).not.toContain("DSD Restore Diver 0");
  });

  it("still restores onto an intro session while the seat is genuinely free", async () => {
    const { db, shop } = await seededContext();
    const trip = await introSession(db, shop.id);
    const booked = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "DSD Undo Diver",
      email: "dsd-undo@example.com",
    });
    if (!booked.ok) throw new Error("setup booking failed");
    await cancelBooking(db, shop.id, booked.bookingId);

    expect(await restoreBooking(db, shop.id, booked.bookingId)).toBe("restored");
    const roster = await getTripRoster(db, shop.id, trip.id);
    expect(roster.map((r) => r.person.fullName)).toContain("DSD Undo Diver");
  });

  /**
   * Which trip states may refuse an undo, and — more importantly — which must
   * not. An undo is not a new booking: it is a staff member taking back a
   * removal they didn't mean to make, so the trip states that stop a *stranger
   * buying a seat* are mostly none of its business.
   *
   * Exactly one refuses: a **cancelled** departure, which has no roster left to
   * put anyone on. The recovery is real and reachable — reinstate the trip,
   * then undo — and the last case below pins that round trip.
   *
   * A **conditions hold** does not refuse. The glossary defines a hold as
   * "existing bookings remain valid, new bookings pause"; the diver whose row
   * was mis-tapped is an existing booking, and putting them back is undoing a
   * clerical slip, not selling a seat.
   *
   * An **already-departed** trip does not refuse either, and this one is a
   * safety matter rather than a nicety: `cancelBooking` has no trip-state gate
   * at all and the Remove control renders on every roster row, including at
   * sea (a departed trip is still `scheduled`, and roll call stays live). If
   * the undo refused there, one misclick would strike a diver off an at-sea
   * manifest permanently. The two errors are not symmetric — an under-listed
   * manifest costs a search, an over-listed one costs a tap.
   *
   * The refusal case asserts the booking row is *still cancelled* afterwards,
   * not merely that the outcome reads as a refusal; the two restore cases
   * assert the diver is genuinely back on `getTripRoster`, not merely that the
   * outcome reads as success. Either check on its own would pass for a bug
   * wearing a better return value.
   */
  it("refuses to restore onto a trip the crew has since cancelled", async () => {
    const { db, shop, open } = await seededContext();
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");
    await cancelBooking(db, shop.id, booked.bookingId);
    await setTripStatus(db, shop.id, open.id, "cancelled");

    expect(await restoreBooking(db, shop.id, booked.bookingId)).toBe("trip_cancelled");
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booked.bookingId));
    expect(row?.status).toBe("cancelled");
    const roster = await getTripRoster(db, shop.id, open.id);
    expect(roster.map((r) => r.person.fullName)).not.toContain(visitor.fullName);
  });

  it("restores onto a trip with a conditions hold in place — an undo is not a new booking", async () => {
    const { db, shop, open } = await seededContext();
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");
    await cancelBooking(db, shop.id, booked.bookingId);
    // The hold that stops `createBooking` selling a seat here (see "rejects
    // new bookings while the crew has a conditions hold in place") pauses new
    // bookings; it does not invalidate the ones already made. This diver was
    // already made.
    await db.update(trips).set({ conditionsHold: true }).where(eq(trips.id, open.id));

    expect(await restoreBooking(db, shop.id, booked.bookingId)).toBe("restored");
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booked.bookingId));
    expect(row?.status).toBe("booked");
    const roster = await getTripRoster(db, shop.id, open.id);
    expect(roster.map((r) => r.person.fullName)).toContain(visitor.fullName);
  });

  it("restores onto a boat that has already departed — a mis-removal at sea must be reversible", async () => {
    const { db, shop, open } = await seededContext();
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");
    await cancelBooking(db, shop.id, booked.bookingId);
    // Sail the trip rather than move the clock, so this reads the same however
    // the suite's clock is frozen. Removing the wrong roster row happens most
    // easily precisely here — one-handed, on a moving deck, during roll call —
    // and the crew must be able to put the name straight back.
    const departed = new Date(nowDate().getTime() - 2 * 60 * 60 * 1000);
    await db
      .update(trips)
      .set({ startsAt: departed, endsAt: new Date(departed.getTime() + 60 * 60 * 1000) })
      .where(eq(trips.id, open.id));

    expect(await restoreBooking(db, shop.id, booked.bookingId)).toBe("restored");
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booked.bookingId));
    expect(row?.status).toBe("booked");
    const roster = await getTripRoster(db, shop.id, open.id);
    expect(roster.map((r) => r.person.fullName)).toContain(visitor.fullName);
  });

  it("takes the undo once the crew reinstates the trip they had cancelled", async () => {
    const { db, shop, open } = await seededContext();
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");
    await cancelBooking(db, shop.id, booked.bookingId);

    // Stood down, so the undo has nowhere to land...
    await setTripStatus(db, shop.id, open.id, "cancelled");
    expect(await restoreBooking(db, shop.id, booked.bookingId)).toBe("trip_cancelled");

    // ...and back on, so it does. This is the whole reason the refusal is
    // allowed to be a refusal: the notice tells the crew to reinstate the trip
    // first, and that instruction has to actually work.
    await setTripStatus(db, shop.id, open.id, "scheduled");
    expect(await restoreBooking(db, shop.id, booked.bookingId)).toBe("restored");
    const roster = await getTripRoster(db, shop.id, open.id);
    expect(roster.map((r) => r.person.fullName)).toContain(visitor.fullName);
  });
});

describe("createBooking identity safeguard (H-13)", () => {
  async function nightTrip(db: AppDb, shopId: string) {
    const trips = await upcomingTripsWithCounts(db, shopId);
    const night = trips.find((t) => t.title.startsWith("Night Dive"));
    if (!night) throw new Error("night trip missing");
    return night;
  }

  async function identityFlag(db: AppDb, bookingId: string) {
    const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    return row?.identityUnconfirmedAt ?? null;
  }

  it("does not flag a brand-new walk-in or a same-human re-book", async () => {
    const { db, shop, open } = await seededContext();
    const night = await nightTrip(db, shop.id);
    const first = await bookVisitor(db, shop.id, open.id);
    if (!first.ok) throw new Error("setup booking failed");
    expect(await identityFlag(db, first.bookingId)).toBeNull();

    // Same person, different case and a middle initial, on another trip.
    const second = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: night.id,
      fullName: "Nora Q. Quinn",
      email: "NORA@example.com",
    });
    if (!second.ok) throw new Error("same-human re-book failed");
    expect(await identityFlag(db, second.bookingId)).toBeNull();
  });

  it("flags a booking that reuses an existing email under a different name, and staff can confirm it", async () => {
    const { db, shop, open } = await seededContext();
    const night = await nightTrip(db, shop.id);
    const first = await bookVisitor(db, shop.id, open.id);
    if (!first.ok) throw new Error("setup booking failed");

    // A different human on Nora's shared inbox books a second trip: reused
    // person, mismatched name — must not silently inherit her evidence.
    const shared = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: night.id,
      fullName: "Ben Quinn",
      email: "nora@example.com",
    });
    if (!shared.ok) throw new Error("shared-inbox booking failed");
    expect(await identityFlag(db, shared.bookingId)).not.toBeNull();

    // Staff confirm identity → flag clears; a second confirm is a no-op.
    expect(await confirmBookingIdentity(db, shop.id, shared.bookingId)).toBe(true);
    expect(await identityFlag(db, shared.bookingId)).toBeNull();
    expect(await confirmBookingIdentity(db, shop.id, shared.bookingId)).toBe(false);
  });

  it("never flags the identity path — an existing diver booked by id submits no name", async () => {
    const { db, shop, open } = await seededContext();
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Priya Sharma",
      email: "priya-h13@example.com",
    });
    if (!diver) throw new Error("diver setup failed");
    const outcome = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: open.id,
      personId: diver.id,
    });
    if (!outcome.ok) throw new Error("existing-diver booking failed");
    expect(await identityFlag(db, outcome.bookingId)).toBeNull();
  });
});

describe("selfCancelBooking (diver self-service, docs ADR 20260727-diver-self-service-cancel)", () => {
  it("cancels a plain booked seat", async () => {
    const { db, shop, open } = await seededContext();
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");

    expect(await selfCancelBooking(db, { shopId: shop.id, bookingId: booked.bookingId })).toEqual({
      ok: true,
    });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booked.bookingId));
    expect(row?.status).toBe("cancelled");
  });

  it("refuses a booking that's already cancelled", async () => {
    const { db, shop, open } = await seededContext();
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");
    await cancelBooking(db, shop.id, booked.bookingId);

    expect(await selfCancelBooking(db, { shopId: shop.id, bookingId: booked.bookingId })).toEqual({
      ok: false,
      reason: "already_cancelled",
    });
  });

  it("refuses a day-of state a diver should never flip back through a pre-trip link", async () => {
    const { db, shop, open } = await seededContext();
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");
    await db
      .update(bookings)
      .set({ status: "checked_in" })
      .where(eq(bookings.id, booked.bookingId));

    expect(await selfCancelBooking(db, { shopId: shop.id, bookingId: booked.bookingId })).toEqual({
      ok: false,
      reason: "not_cancellable",
    });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booked.bookingId));
    expect(row?.status).toBe("checked_in");
  });

  it("refuses to cancel a seat on a trip that's already departed", async () => {
    const { db, shop, open } = await seededContext();
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");

    const result = await selfCancelBooking(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      now: new Date(open.startsAt.getTime() + 60 * 60 * 1000), // an hour after departure
    });
    expect(result).toEqual({ ok: false, reason: "trip_departed" });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booked.bookingId));
    expect(row?.status).toBe("booked");
  });

  it("scopes to the shop and reports an unknown booking as not found", async () => {
    const { db, shop } = await seededContext();
    expect(
      await selfCancelBooking(db, {
        shopId: shop.id,
        bookingId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("rescheduleBooking (diver self-service, docs ADR 20260727-diver-self-service-cancel)", () => {
  async function nightTrip(db: AppDb, shopId: string) {
    const upcoming = await upcomingTripsWithCounts(db, shopId);
    const night = upcoming.find((t) => t.title.startsWith("Night Dive"));
    if (!night) throw new Error("night trip missing");
    return night;
  }

  it("moves an unpaid booking to a different trip, atomically", async () => {
    const { db, shop, open } = await seededContext();
    const night = await nightTrip(db, shop.id);
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");

    const result = await rescheduleBooking(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      newTripId: night.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const [oldRow] = await db.select().from(bookings).where(eq(bookings.id, booked.bookingId));
    expect(oldRow?.status).toBe("cancelled");
    const [newRow] = await db.select().from(bookings).where(eq(bookings.id, result.newBookingId));
    expect(newRow?.status).toBe("booked");
    expect(newRow?.tripId).toBe(night.id);
    expect(newRow?.personId).toBe(oldRow?.personId);

    const nightRoster = await getTripRoster(db, shop.id, night.id);
    expect(nightRoster.map((r) => r.person.fullName)).toContain(visitor.fullName);
    const openRoster = await getTripRoster(db, shop.id, open.id);
    expect(openRoster.map((r) => r.person.fullName)).not.toContain(visitor.fullName);
  });

  it("never touches the old booking when the destination trip is full — the diver keeps their seat", async () => {
    const { db, shop, open, fullTrip } = await seededContext();
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");

    const result = await rescheduleBooking(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      newTripId: fullTrip.id,
    });
    expect(result).toEqual({ ok: false, reason: "trip_full" });

    // The exact property a diver needs: rejected on the new trip, still
    // holding the old one — never neither.
    const [oldRow] = await db.select().from(bookings).where(eq(bookings.id, booked.bookingId));
    expect(oldRow?.status).toBe("booked");
    expect(oldRow?.tripId).toBe(open.id);
    const openRoster = await getTripRoster(db, shop.id, open.id);
    expect(openRoster.map((r) => r.person.fullName)).toContain(visitor.fullName);
  });

  it("refuses to reschedule a booking that already captured payment", async () => {
    const { db, shop, open } = await seededContext();
    const night = await nightTrip(db, shop.id);
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      status: "paid",
      currency: "usd",
      amountCents: 15_000,
      provider: "stripe",
      providerRef: "cs_test_1",
    });

    const result = await rescheduleBooking(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      newTripId: night.id,
    });
    expect(result).toEqual({ ok: false, reason: "already_paid" });
    const [oldRow] = await db.select().from(bookings).where(eq(bookings.id, booked.bookingId));
    expect(oldRow?.status).toBe("booked");
    expect(oldRow?.tripId).toBe(open.id);
  });

  it("refuses to reschedule a waived booking — staff excused the fee, not just deferred it (Codex finding)", async () => {
    const { db, shop, open } = await seededContext();
    const night = await nightTrip(db, shop.id);
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      status: "waived",
      currency: "usd",
      amountCents: 0,
      provider: null,
      note: "Comp'd for a rebooking mixup",
    });

    const result = await rescheduleBooking(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      newTripId: night.id,
    });
    expect(result).toEqual({ ok: false, reason: "already_paid" });
    const [oldRow] = await db.select().from(bookings).where(eq(bookings.id, booked.bookingId));
    expect(oldRow?.status).toBe("booked");
    expect(oldRow?.tripId).toBe(open.id);
  });

  it("refuses to reschedule onto the same trip", async () => {
    const { db, shop, open } = await seededContext();
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");

    expect(
      await rescheduleBooking(db, {
        shopId: shop.id,
        bookingId: booked.bookingId,
        newTripId: open.id,
      }),
    ).toEqual({ ok: false, reason: "same_trip" });
  });

  it("refuses to reschedule an already-cancelled booking", async () => {
    const { db, shop, open } = await seededContext();
    const night = await nightTrip(db, shop.id);
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");
    await cancelBooking(db, shop.id, booked.bookingId);

    expect(
      await rescheduleBooking(db, {
        shopId: shop.id,
        bookingId: booked.bookingId,
        newTripId: night.id,
      }),
    ).toEqual({ ok: false, reason: "already_cancelled" });
  });

  it("refuses to reschedule a seat on a trip that's already departed", async () => {
    const { db, shop, open } = await seededContext();
    const night = await nightTrip(db, shop.id);
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");

    const result = await rescheduleBooking(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      newTripId: night.id,
      now: new Date(open.startsAt.getTime() + 60 * 60 * 1000),
    });
    expect(result).toEqual({ ok: false, reason: "trip_departed" });
  });

  it("reactivates a previously-cancelled seat on the destination trip instead of double-booking it", async () => {
    const { db, shop, open } = await seededContext();
    const night = await nightTrip(db, shop.id);
    // The diver already had (and cancelled) a seat on the night trip once.
    const priorNightBooking = await bookVisitor(db, shop.id, night.id);
    if (!priorNightBooking.ok) throw new Error("setup booking failed");
    await cancelBooking(db, shop.id, priorNightBooking.bookingId);
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");

    const result = await rescheduleBooking(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      newTripId: night.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    // Reused the same row `createBookingRecord` already reactivates on a
    // cancelled-then-rebooked seat, rather than inserting a duplicate.
    expect(result.newBookingId).toBe(priorNightBooking.bookingId);
  });

  it("clears a stale nitrox request on a reactivated destination seat (Codex finding)", async () => {
    const { db, shop, open } = await seededContext();
    const night = await nightTrip(db, shop.id);
    // The diver's earlier (now-cancelled) seat on the night trip wanted
    // nitrox — that row is about to be reactivated by the reschedule below.
    const priorNightBooking = await bookVisitor(db, shop.id, night.id);
    if (!priorNightBooking.ok) throw new Error("setup booking failed");
    await db
      .update(bookings)
      .set({ wantsNitrox: true })
      .where(eq(bookings.id, priorNightBooking.bookingId));
    await cancelBooking(db, shop.id, priorNightBooking.bookingId);
    // The booking actually being moved never asked for nitrox.
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");

    const result = await rescheduleBooking(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      newTripId: night.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const [reactivated] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, result.newBookingId));
    expect(reactivated?.wantsNitrox).toBe(false);
  });

  it("refuses to reactivate a destination seat carrying a stale settled payment from its earlier life (Codex finding)", async () => {
    const { db, shop, open } = await seededContext();
    const night = await nightTrip(db, shop.id);
    // The diver's earlier (now-cancelled) seat on the night trip was paid —
    // a no-policy/forfeit cancellation deliberately leaves the payment
    // captured, so this row still reads "paid" even though it's cancelled.
    const priorNightBooking = await bookVisitor(db, shop.id, night.id);
    if (!priorNightBooking.ok) throw new Error("setup booking failed");
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: priorNightBooking.bookingId,
      status: "paid",
      currency: "usd",
      amountCents: 15_000,
      provider: "stripe",
      providerRef: "cs_test_prior",
    });
    await cancelBooking(db, shop.id, priorNightBooking.bookingId);
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");

    const result = await rescheduleBooking(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      newTripId: night.id,
    });
    expect(result).toEqual({ ok: false, reason: "destination_already_paid" });
    // Refused before touching the source booking — the diver keeps their seat.
    const [oldRow] = await db.select().from(bookings).where(eq(bookings.id, booked.bookingId));
    expect(oldRow?.status).toBe("booked");
    expect(oldRow?.tripId).toBe(open.id);
    // The destination row was never left "booked" either — the whole
    // transaction rolled back, so the diver's old (paid, cancelled) seat on
    // the night trip stays exactly as it was: cancelled.
    const [destinationRow] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, priorNightBooking.bookingId));
    expect(destinationRow?.status).toBe("cancelled");
  });

  it("refuses to reactivate a destination seat carrying a refunded payment from its earlier life (Codex finding)", async () => {
    const { db, shop, open } = await seededContext();
    const night = await nightTrip(db, shop.id);
    // `refunded` is a FINAL_PAYMENT_STATUSES entry, same as `paid`/`waived` —
    // omitting it from the destination-payment gate would let this
    // reactivation through, and a later real payment on the reactivated seat
    // would then be silently swallowed by setBookingPaymentIfNotFinal's
    // refusal to regress a final status, leaving the diver charged while the
    // booking still reads "refunded".
    const priorNightBooking = await bookVisitor(db, shop.id, night.id);
    if (!priorNightBooking.ok) throw new Error("setup booking failed");
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: priorNightBooking.bookingId,
      status: "refunded",
      currency: "usd",
      amountCents: 15_000,
      provider: "stripe",
      providerRef: "cs_test_prior_refunded",
    });
    await cancelBooking(db, shop.id, priorNightBooking.bookingId);
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");

    const result = await rescheduleBooking(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      newTripId: night.id,
    });
    expect(result).toEqual({ ok: false, reason: "destination_already_paid" });
  });

  it("retires a stale pending checkout linked to a reactivated destination seat (Codex finding)", async () => {
    const { db, shop, open } = await seededContext();
    const night = await nightTrip(db, shop.id);
    // The diver started paying for their earlier seat on the night trip,
    // abandoned the tab before completing it, then cancelled — the checkout
    // session itself is still genuinely payable at Stripe, at that seat's
    // old price. Reactivating the same booking row onto a *different* diver's
    // move must not leave that old session able to attribute money to it.
    const priorNightBooking = await bookVisitor(db, shop.id, night.id);
    if (!priorNightBooking.ok) throw new Error("setup booking failed");
    const [staleCheckout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shop.id,
        tripId: night.id,
        status: "pending",
        stripeAccountId: "acct_test",
        stripeSessionId: "cs_test_stale",
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_stale",
        amountPerDiverCents: 15_000,
        totalCents: 15_000,
      })
      .returning();
    if (!staleCheckout) throw new Error("setup checkout insert failed");
    await db.insert(bookingCheckoutBookings).values({
      shopId: shop.id,
      checkoutId: staleCheckout.id,
      bookingId: priorNightBooking.bookingId,
    });
    await cancelBooking(db, shop.id, priorNightBooking.bookingId);
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");

    const result = await rescheduleBooking(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      newTripId: night.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.newBookingId).toBe(priorNightBooking.bookingId);

    const [checkoutRow] = await db
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.id, staleCheckout.id));
    expect(checkoutRow?.status).toBe("expired");
  });

  it("refuses to reschedule a booking still flagged identity_unconfirmed (H-13, dive-domain-expert finding)", async () => {
    const { db, shop, open } = await seededContext();
    const night = await nightTrip(db, shop.id);
    const third = (await upcomingTripsWithCounts(db, shop.id)).find(
      (t) => t.title === "Two-Tank Reef — Benwood & Elbow",
    );
    if (!third) throw new Error("third trip missing");
    const first = await bookVisitor(db, shop.id, open.id);
    if (!first.ok) throw new Error("setup booking failed");
    // A different human on the same shared inbox books a second seat on a
    // different trip — reused person, mismatched name, so the identity flag
    // is set on this booking.
    const shared = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: night.id,
      fullName: "Ben Quinn",
      email: visitor.email,
    });
    if (!shared.ok) throw new Error("shared-inbox booking failed");

    const result = await rescheduleBooking(db, {
      shopId: shop.id,
      bookingId: shared.bookingId,
      newTripId: third.id,
    });
    expect(result).toEqual({ ok: false, reason: "identity_unconfirmed" });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, shared.bookingId));
    expect(row?.status).toBe("booked");
    expect(row?.tripId).toBe(night.id);
  });

  it("carries a nitrox request forward onto the new booking instead of silently resetting it", async () => {
    const { db, shop, open } = await seededContext();
    const night = await nightTrip(db, shop.id);
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");
    await db.update(bookings).set({ wantsNitrox: true }).where(eq(bookings.id, booked.bookingId));

    const result = await rescheduleBooking(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      newTripId: night.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const [newRow] = await db.select().from(bookings).where(eq(bookings.id, result.newBookingId));
    expect(newRow?.wantsNitrox).toBe(true);
  });
});

describe("cancelBooking (staff cancellation runs status update + capability revoke atomically)", () => {
  it("cancels the booking and revokes its outstanding capabilities together", async () => {
    const { db, shop, open } = await seededContext();
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");
    const issued = await bookingCapabilitiesModule.issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      purpose: "readiness",
    });
    if (!issued) throw new Error("setup capability failed");

    await cancelBooking(db, shop.id, booked.bookingId);

    const [row] = await db.select().from(bookings).where(eq(bookings.id, booked.bookingId));
    expect(row?.status).toBe("cancelled");
    const [capability] = await db
      .select()
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.bookingId, booked.bookingId));
    expect(capability?.revokedAt).not.toBeNull();
  });

  it("rolls the booking status back to booked when the capability revoke fails, instead of leaving it cancelled with live capabilities", async () => {
    const { db, shop, open } = await seededContext();
    const booked = await bookVisitor(db, shop.id, open.id);
    if (!booked.ok) throw new Error("setup booking failed");
    const issued = await bookingCapabilitiesModule.issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      purpose: "readiness",
    });
    if (!issued) throw new Error("setup capability failed");

    const revokeSpy = vi
      .spyOn(bookingCapabilitiesModule, "revokeBookingCapabilities")
      .mockRejectedValueOnce(new Error("simulated revoke failure"));
    try {
      await expect(cancelBooking(db, shop.id, booked.bookingId)).rejects.toThrow(
        "simulated revoke failure",
      );
    } finally {
      revokeSpy.mockRestore();
    }

    // The failed revoke must have rolled the status write back too — an
    // atomic cancelBooking never leaves the booking cancelled while its
    // capabilities are still live.
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booked.bookingId));
    expect(row?.status).toBe("booked");
    const [capability] = await db
      .select()
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.bookingId, booked.bookingId));
    expect(capability?.revokedAt).toBeNull();
  });
});
