// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { cancelBooking, createBooking, createBookingParty, restoreBooking } from "./bookings";
import type { AppDb } from "./client";
import { createDiver } from "./divers";
import { bookings, people, personRoles } from "./schema";
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
  return createBooking(db, { shopId, tripId, ...visitor });
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
      { shopId: shop.id, tripId: open.id, fullName: "Nora Quinn", email: "nora@example.com" },
      { shopId: shop.id, tripId: open.id, fullName: "Sam Quinn", email: "sam@example.com" },
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
      { shopId: shop.id, tripId: open.id, fullName: "Nora Quinn", email: "nora@example.com" },
      // Same email as the first member → already_booked, so the first
      // member's insert must roll back too (all-or-nothing reservation).
      { shopId: shop.id, tripId: open.id, fullName: "Nora Quinn", email: "nora@example.com" },
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
      shopId: shop.id,
      tripId: open.id,
      personId: diver.id,
    });
    expect(outcome).toEqual({ ok: false, reason: "person_not_found" });
  });

  it("rejects re-booking the same trip by identity", async () => {
    const { db, shop, open } = await seededContext();
    const diver = await seedDiver(db, shop.id);
    await createBooking(db, { shopId: shop.id, tripId: open.id, personId: diver.id });
    const again = await createBooking(db, {
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
