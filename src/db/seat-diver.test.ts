// @vitest-environment node
import { and, eq, inArray, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { activityEvents, bookings, people, personRoles, waiverRecords } from "./schema";
import { seatDiver } from "./seat-diver";
import { upcomingTripsWithCounts } from "./trips";

/** The same two seeded departures `bookings.test.ts` works against. */
async function context() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((trip) => trip.title === "Two-Tank Reef — Christ of the Abyss");
  const fullTrip = trips.find((trip) => trip.title === "Wreck Trip — Spiegel Grove");
  if (!open || !fullTrip) throw new Error("expected seeded trips missing");
  const [staff] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), inArray(personRoles.role, ["owner", "manager"])))
    .limit(1);
  if (!staff) throw new Error("seed has no staff actor");
  return { db, shop, open, fullTrip, actorPersonId: staff.id };
}

/**
 * A seeded diver who is not already on `tripId` — the returning-diver picker's
 * own precondition, so a test can seat one by identity the way every picker
 * does.
 */
async function bookableDiver(db: AppDb, shopId: string, tripId: string) {
  const booked = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(and(eq(bookings.tripId, tripId), ne(bookings.status, "cancelled")));
  const bookedIds = new Set(booked.map((row) => row.personId));
  const rows = await db
    .select({ id: people.id, fullName: people.fullName })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "diver")));
  const person = rows.find((row) => !bookedIds.has(row.id));
  if (!person) throw new Error("seed has no bookable diver");
  return person;
}

async function activityMessages(db: AppDb, tripId: string) {
  const rows = await db
    .select({ message: activityEvents.message })
    .from(activityEvents)
    .where(eq(activityEvents.tripId, tripId));
  return rows.map((row) => row.message);
}

async function waiverCount(db: AppDb, bookingId: string) {
  const rows = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(eq(waiverRecords.bookingId, bookingId));
  return rows.length;
}

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

describe("seatDiver (the one consequence path behind every staff door)", () => {
  /**
   * The bug this extraction exists for. Booking a diver from their own record
   * called `createBooking` and stopped there — no waiver, ever — so a diver
   * seated that way reached the dock unsigned and nothing upstream said why.
   * The diver-record door is `entry: "roster"` seating an existing person by
   * id: exactly this call.
   */
  it("issues the waiver when a returning diver is seated by identity", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const diver = await bookableDiver(db, shop.id, open.id);

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: diver.id },
      entry: "roster",
      refusals: "specific",
    });

    expect(result).toMatchObject({ ok: true, personId: diver.id, waiver: "issued" });
    if (!result.ok) throw new Error("expected the diver to be seated");
    expect(await waiverCount(db, result.bookingId)).toBe(1);
  });

  it("leaves the trip's activity trail, phrased for the roster door", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const diver = await bookableDiver(db, shop.id, open.id);

    await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: diver.id },
      entry: "roster",
      refusals: "specific",
    });

    expect(await activityMessages(db, open.id)).toContainEqual(
      expect.stringContaining(`added ${diver.fullName} to the trip`),
    );
  });

  it("says a walk-in was a walk-in on the trail, and takes a diver with no email", async () => {
    const { db, shop, open, actorPersonId } = await context();

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      // The counter's shape: a name and nothing else.
      diver: { fullName: "Counter Cass" },
      entry: "walk_in",
      refusals: "coarse",
    });

    expect(result).toMatchObject({ ok: true, personName: "Counter Cass", waiver: "issued" });
    expect(await activityMessages(db, open.id)).toContainEqual(
      expect.stringContaining("added Counter Cass to the trip as a walk-in"),
    );
  });

  it("names the person on the trail even when the door submitted no name", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const diver = await bookableDiver(db, shop.id, open.id);

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: diver.id },
      entry: "walk_in",
      refusals: "coarse",
    });

    expect(result).toMatchObject({ ok: true, personName: diver.fullName });
    expect(await activityMessages(db, open.id)).toContainEqual(
      expect.stringContaining(`added ${diver.fullName} to the trip as a walk-in`),
    );
  });

  it("never stacks a second waiver link on a booking that already has one", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const diver = await bookableDiver(db, shop.id, open.id);
    const first = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: diver.id },
      entry: "roster",
      refusals: "specific",
    });
    if (!first.ok) throw new Error("expected the diver to be seated");

    // Re-seating the same diver is refused outright, which is the guarantee
    // that matters: a retried submission cannot issue a second link.
    const second = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: diver.id },
      entry: "roster",
      refusals: "specific",
    });

    expect(second).toEqual({ ok: false, reason: "already_booked" });
    expect(await waiverCount(db, first.bookingId)).toBe(1);
  });

  it("records nothing at all when the booking itself is refused", async () => {
    const { db, shop, fullTrip, actorPersonId } = await context();
    const before = await activityMessages(db, fullTrip.id);

    await seatDiver(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      actorPersonId,
      diver: { fullName: "Turned Away Tara" },
      entry: "roster",
      refusals: "specific",
    });

    expect(await activityMessages(db, fullTrip.id)).toEqual(before);
  });
});

describe("seatDiver refusal granularity (the per-surface parameter)", () => {
  it("keeps each refusal distinct for a surface that asked for specifics", async () => {
    const { db, shop, open, actorPersonId } = await context();

    const unknownPerson = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: UNKNOWN_ID },
      entry: "roster",
      refusals: "specific",
    });
    const unknownTrip = await seatDiver(db, {
      shopId: shop.id,
      tripId: UNKNOWN_ID,
      actorPersonId,
      diver: { fullName: "Nobody Home" },
      entry: "roster",
      refusals: "specific",
    });

    expect(unknownPerson).toEqual({ ok: false, reason: "person_not_found" });
    expect(unknownTrip).toEqual({ ok: false, reason: "trip_unavailable" });
  });

  it("collapses those same refusals to one honest code for the counter", async () => {
    const { db, shop, open, actorPersonId } = await context();

    const unknownPerson = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: UNKNOWN_ID },
      entry: "walk_in",
      refusals: "coarse",
    });
    const unknownTrip = await seatDiver(db, {
      shopId: shop.id,
      tripId: UNKNOWN_ID,
      actorPersonId,
      diver: { fullName: "Nobody Home" },
      entry: "walk_in",
      refusals: "coarse",
    });

    expect(unknownPerson).toEqual({ ok: false, reason: "unavailable" });
    expect(unknownTrip).toEqual({ ok: false, reason: "unavailable" });
  });

  /**
   * "This boat is full" and "they're already on it" are the two refusals a
   * staffer at the counter acts on differently — one sends them to the wait
   * list, the other is a shrug — so the collapse deliberately lets both
   * through. Collapsing them too would be the counter losing information it
   * uses, rather than being spared information it does not.
   */
  it("never collapses the two refusals the counter still acts on", async () => {
    const { db, shop, open, fullTrip, actorPersonId } = await context();
    const diver = await bookableDiver(db, shop.id, open.id);
    await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: diver.id },
      entry: "walk_in",
      refusals: "coarse",
    });

    const again = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { personId: diver.id },
      entry: "walk_in",
      refusals: "coarse",
    });
    const onFullBoat = await seatDiver(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      actorPersonId,
      diver: { fullName: "Counter Cass" },
      entry: "walk_in",
      refusals: "coarse",
    });

    expect(again).toEqual({ ok: false, reason: "already_booked" });
    expect(onFullBoat).toEqual({ ok: false, reason: "trip_full" });
  });
});
