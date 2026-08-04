import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { listTripBuddyPairs, pairBuddies, unpairBuddies } from "./buddy-pairs";
import { getTripManifest, getTripManifests, recordRollCall } from "./manifests";
import { bookings, buddyPairMembers, trips } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

/**
 * The Benwood reef trip: three booked divers and — unlike today's Molasses
 * boat — no seeded buddy pairs, so every test starts from an unpaired roster
 * with an odd count (odd counts are normal, never an error).
 */
async function buddyContext() {
  const { db, shop } = await seededShopContext();
  const tripRows = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = tripRows.find((row) => row.title.startsWith("Two-Tank Reef — Benwood"));
  if (!trip) throw new Error("demo Benwood trip missing");
  const roster = await getTripRoster(db, shop.id, trip.id);
  const [a, b, c] = roster;
  if (!a || !b || !c) throw new Error("expected three Benwood bookings");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  return { db, shop, trip, a, b, c, staff: staff.person };
}

describe("buddy pairs (in-memory PGlite)", () => {
  it("pairs two roster entries and reads the pair back, both ways round", async () => {
    const { db, shop, trip, a, b, c, staff } = await buddyContext();
    const outcome = await pairBuddies(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingIdA: a.booking.id,
      bookingIdB: b.booking.id,
      pairedByPersonId: staff.id,
    });
    expect(outcome).toMatchObject({ ok: true });

    const pairs = await listTripBuddyPairs(db, shop.id, trip.id);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.members.map((member) => member.bookingId).sort()).toEqual(
      [a.booking.id, b.booking.id].sort(),
    );
    expect(pairs[0]?.members.every((member) => !member.cancelled)).toBe(true);
    expect(pairs[0]?.pairedByName).toBe(staff.fullName);

    // The manifest carries the pair symmetrically, and the odd diver out is
    // simply unpaired — never an error.
    const manifest = await getTripManifest(db, shop.id, trip.id);
    const byBooking = new Map(manifest?.divers.map((diver) => [diver.bookingId, diver]));
    expect(byBooking.get(a.booking.id)?.buddy).toEqual({
      bookingId: b.booking.id,
      fullName: b.person.fullName,
    });
    expect(byBooking.get(b.booking.id)?.buddy).toEqual({
      bookingId: a.booking.id,
      fullName: a.person.fullName,
    });
    expect(byBooking.get(c.booking.id)?.buddy).toBeNull();
  });

  it("never lets a pair touch checkpoint completeness", async () => {
    const { db, shop, trip, a, b, staff } = await buddyContext();
    const before = await getTripManifests(db, shop.id, trip.id);
    await pairBuddies(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingIdA: a.booking.id,
      bookingIdB: b.booking.id,
      pairedByPersonId: staff.id,
    });
    const after = await getTripManifests(db, shop.id, trip.id);
    expect(after?.map((manifest) => manifest.completeness)).toEqual(
      before?.map((manifest) => manifest.completeness),
    );
  });

  it("refuses to pair a diver with themself", async () => {
    const { db, shop, trip, a, staff } = await buddyContext();
    const outcome = await pairBuddies(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingIdA: a.booking.id,
      bookingIdB: a.booking.id,
      pairedByPersonId: staff.id,
    });
    expect(outcome).toEqual({ ok: false, reason: "same_booking" });
    expect(await listTripBuddyPairs(db, shop.id, trip.id)).toEqual([]);
  });

  it("refuses a booking from a different trip", async () => {
    const { db, shop, trip, a, staff } = await buddyContext();
    const tripRows = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const other = tripRows.find((row) => row.title.startsWith("Afternoon Two-Tank"));
    if (!other) throw new Error("demo afternoon trip missing");
    const [foreign] = await getTripRoster(db, shop.id, other.id);
    if (!foreign) throw new Error("expected an afternoon booking");
    const outcome = await pairBuddies(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingIdA: a.booking.id,
      bookingIdB: foreign.booking.id,
      pairedByPersonId: staff.id,
    });
    expect(outcome).toEqual({ ok: false, reason: "booking_unavailable" });
  });

  it("refuses a cancelled booking", async () => {
    const { db, shop, trip, a, b, staff } = await buddyContext();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, b.booking.id));
    const outcome = await pairBuddies(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingIdA: a.booking.id,
      bookingIdB: b.booking.id,
      pairedByPersonId: staff.id,
    });
    expect(outcome).toEqual({ ok: false, reason: "booking_unavailable" });
  });

  it("refuses an already-paired diver — unpair first, never a silent re-pair", async () => {
    const { db, shop, trip, a, b, c, staff } = await buddyContext();
    const base = {
      shopId: shop.id,
      tripId: trip.id,
      pairedByPersonId: staff.id,
    };
    await pairBuddies(db, { ...base, bookingIdA: a.booking.id, bookingIdB: b.booking.id });
    expect(
      await pairBuddies(db, { ...base, bookingIdA: a.booking.id, bookingIdB: c.booking.id }),
    ).toEqual({ ok: false, reason: "already_paired" });
    expect(
      await pairBuddies(db, { ...base, bookingIdA: c.booking.id, bookingIdB: b.booking.id }),
    ).toEqual({ ok: false, reason: "already_paired" });

    // The explicit path: unpair, then the new pairing is allowed.
    expect(
      await unpairBuddies(db, { shopId: shop.id, tripId: trip.id, bookingId: a.booking.id }),
    ).toEqual({ ok: true });
    expect(await listTripBuddyPairs(db, shop.id, trip.id)).toEqual([]);
    expect(
      await pairBuddies(db, { ...base, bookingIdA: a.booking.id, bookingIdB: c.booking.id }),
    ).toMatchObject({ ok: true });
  });

  it("enforces one-pair-per-booking at the database, not just in the pre-check", async () => {
    const { db, shop, trip, a, staff } = await buddyContext();
    const row = {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: a.booking.id,
      pairedByPersonId: staff.id,
    };
    await db.insert(buddyPairMembers).values({ ...row, pairId: crypto.randomUUID() });
    // A second membership for the same booking — what a lost race would
    // insert — must be a unique violation, whatever the application checked.
    await expect(
      db.insert(buddyPairMembers).values({ ...row, pairId: crypto.randomUUID() }),
    ).rejects.toThrow();
  });

  it("refuses a recorder who is not staff in the shop", async () => {
    const { db, shop, trip, a, b } = await buddyContext();
    const outcome = await pairBuddies(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingIdA: a.booking.id,
      bookingIdB: b.booking.id,
      // A customer is a person in the shop but holds no staff role.
      pairedByPersonId: a.person.id,
    });
    expect(outcome).toEqual({ ok: false, reason: "staff_not_found" });
  });

  it("refuses a trip that is not scheduled, and a trip id from nowhere", async () => {
    const { db, shop, trip, a, b, staff } = await buddyContext();
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
    expect(
      await pairBuddies(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingIdA: a.booking.id,
        bookingIdB: b.booking.id,
        pairedByPersonId: staff.id,
      }),
    ).toEqual({ ok: false, reason: "trip_unavailable" });
    expect(
      await pairBuddies(db, {
        shopId: shop.id,
        tripId: crypto.randomUUID(),
        bookingIdA: a.booking.id,
        bookingIdB: b.booking.id,
        pairedByPersonId: staff.id,
      }),
    ).toEqual({ ok: false, reason: "trip_unavailable" });
  });

  it("unpairing nobody is a worded refusal, and unpairing is tenant-scoped", async () => {
    const { db, shop, trip, a, b, staff } = await buddyContext();
    expect(
      await unpairBuddies(db, { shopId: shop.id, tripId: trip.id, bookingId: a.booking.id }),
    ).toEqual({ ok: false, reason: "not_paired" });

    await pairBuddies(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingIdA: a.booking.id,
      bookingIdB: b.booking.id,
      pairedByPersonId: staff.id,
    });
    // A bare booking UUID under the wrong shop or trip unpairs nothing.
    expect(
      await unpairBuddies(db, {
        shopId: crypto.randomUUID(),
        tripId: trip.id,
        bookingId: a.booking.id,
      }),
    ).toEqual({ ok: false, reason: "not_paired" });
    expect(
      await unpairBuddies(db, {
        shopId: shop.id,
        tripId: crypto.randomUUID(),
        bookingId: a.booking.id,
      }),
    ).toEqual({ ok: false, reason: "not_paired" });
    expect(await listTripBuddyPairs(db, shop.id, trip.id)).toHaveLength(1);
  });

  it("keeps a half-cancelled pair visible and dissolvable, but off the manifest", async () => {
    const { db, shop, trip, a, b, c, staff } = await buddyContext();
    await pairBuddies(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingIdA: a.booking.id,
      bookingIdB: b.booking.id,
      pairedByPersonId: staff.id,
    });
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, b.booking.id));

    // The pairs list still shows it, marked, so staff can dissolve it.
    const pairs = await listTripBuddyPairs(db, shop.id, trip.id);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.members.find((member) => member.bookingId === b.booking.id)?.cancelled).toBe(
      true,
    );

    // The manifest shows no buddy for the survivor — a cancelled seat is
    // nobody — and boarding the survivor after a dive raises no alert about
    // a person who is not on the boat.
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: a.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
      checkpoint: "after_dive_1",
    });
    const manifest = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
    const survivor = manifest?.divers.find((diver) => diver.bookingId === a.booking.id);
    expect(survivor?.buddy).toBeNull();
    expect(survivor?.buddyAlert).toBeNull();

    // The survivor cannot be silently re-paired past the stale pair…
    expect(
      await pairBuddies(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingIdA: a.booking.id,
        bookingIdB: c.booking.id,
        pairedByPersonId: staff.id,
      }),
    ).toEqual({ ok: false, reason: "already_paired" });
    // …until the pair is explicitly dissolved.
    expect(
      await unpairBuddies(db, { shopId: shop.id, tripId: trip.id, bookingId: a.booking.id }),
    ).toEqual({ ok: true });
    expect(
      await pairBuddies(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingIdA: a.booking.id,
        bookingIdB: c.booking.id,
        pairedByPersonId: staff.id,
      }),
    ).toMatchObject({ ok: true });
  });

  it("derives the split-pair alert on the diver who is back, and settles it when the buddy boards", async () => {
    const { db, shop, trip, a, b, staff } = await buddyContext();
    await pairBuddies(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingIdA: a.booking.id,
      bookingIdB: b.booking.id,
      pairedByPersonId: staff.id,
    });

    // After dive 1, a human boards one buddy; the other has no result yet.
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: a.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
      checkpoint: "after_dive_1",
    });
    let manifest = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
    let back = manifest?.divers.find((diver) => diver.bookingId === a.booking.id);
    const waiting = manifest?.divers.find((diver) => diver.bookingId === b.booking.id);
    expect(back?.buddyAlert).toBe("separated_after_dive");
    // The unaccounted buddy's own row carries their own state; the pair
    // alert renders on the diver who is back, where the deck looks.
    expect(waiting?.buddyAlert).toBeNull();

    // A human then records the buddy back aboard, and the pair settles.
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: b.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
      checkpoint: "after_dive_1",
    });
    manifest = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
    back = manifest?.divers.find((diver) => diver.bookingId === a.booking.id);
    expect(back?.buddyAlert).toBeNull();
  });

  it("stays loud when the buddy was explicitly recorded not back aboard", async () => {
    const { db, shop, trip, a, b, staff } = await buddyContext();
    await pairBuddies(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingIdA: a.booking.id,
      bookingIdB: b.booking.id,
      pairedByPersonId: staff.id,
    });
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: a.booking.id,
      recordedByPersonId: staff.id,
      status: "boarded",
      checkpoint: "after_dive_1",
    });
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: b.booking.id,
      recordedByPersonId: staff.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
    });
    const manifest = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
    const back = manifest?.divers.find((diver) => diver.bookingId === a.booking.id);
    expect(back?.buddyAlert).toBe("separated_after_dive");
  });
});
