// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
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
import { bookingCheckoutBookings, bookingCheckouts, bookings, people, personRoles } from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

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

  it("rejects a full trip", async () => {
    const { db, shop, fullTrip } = await seededContext();
    const outcome = await bookVisitor(db, shop.id, fullTrip.id);
    expect(outcome).toEqual({ ok: false, reason: "trip_full" });
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
    expect(outcome).toEqual({ ok: false, reason: "already_booked" });
    expect(await getTripRoster(db, shop.id, open.id)).toHaveLength(before);
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
