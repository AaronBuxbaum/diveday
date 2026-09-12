import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { bookings, people, trips, tripWaitlistEntries } from "./schema";
import {
  getTripRoster,
  getTripWaitlist,
  getWaitlistEntryForTrip,
  listTripDiverContacts,
} from "./trips-roster";

const OTHER_SHOP = "00000000-0000-0000-0000-000000000000";

/**
 * Booking uuids chosen so the pair's ordering by `id` is known and opposite on
 * the two departures the tie-break test seats — the whole point being that the
 * answer must not depend on them.
 */
const LOW_BOOKING_ID = "11111111-1111-4111-8111-111111111111";
const HIGH_BOOKING_ID = "99999999-9999-4999-8999-999999999999";
const OTHER_LOW_BOOKING_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_HIGH_BOOKING_ID = "88888888-8888-4888-8888-888888888888";

let seq = 0;

async function makeDiver(
  db: AppDb,
  shopId: string,
  opts: { deleted?: boolean; name?: string } = {},
) {
  seq += 1;
  const [person] = await db
    .insert(people)
    .values({
      shopId,
      fullName: opts.name ?? `Diver ${seq}`,
      email: `diver.${seq}@bluemantis.dive`,
      deletedAt: opts.deleted ? new Date("2026-06-01T00:00:00Z") : null,
    })
    .returning({ id: people.id, fullName: people.fullName, email: people.email });
  if (!person) throw new Error("failed to insert diver");
  return person;
}

/**
 * Two seeded departures of the demo shop. Which two does not matter: every
 * assertion below is about rows this file adds, so the seeded bookings are
 * filtered out by person id rather than assumed absent.
 */
async function twoTrips(db: AppDb, shopId: string) {
  const rows = await db
    .select({ id: trips.id })
    .from(trips) // diveday:allow-deleted-trips: fixture lookup — any two departures will do
    .where(eq(trips.shopId, shopId))
    .limit(2);
  const [a, b] = rows;
  if (!a || !b) throw new Error("expected the seeded shop to have two departures");
  return [a.id, b.id] as const;
}

describe("getTripRoster", () => {
  it("lists every non-cancelled seat, oldest first, with its person", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await twoTrips(db, shop.id);
    const booked = await makeDiver(db, shop.id);
    const checkedIn = await makeDiver(db, shop.id);
    const noShow = await makeDiver(db, shop.id);
    const cancelled = await makeDiver(db, shop.id);
    for (const [person, status] of [
      [booked, "booked"],
      [checkedIn, "checked_in"],
      [noShow, "no_show"],
      [cancelled, "cancelled"],
    ] as const) {
      await db
        .insert(bookings)
        .values({ shopId: shop.id, tripId: trip, personId: person.id, status });
    }

    const ours = new Set([booked.id, checkedIn.id, noShow.id, cancelled.id]);
    const roster = (await getTripRoster(db, shop.id, trip)).filter((row) =>
      ours.has(row.person.id),
    );
    expect(roster.map((row) => [row.person.id, row.booking.status])).toEqual([
      [booked.id, "booked"],
      [checkedIn.id, "checked_in"],
      [noShow.id, "no_show"],
    ]);
    expect(roster.every((row) => row.booking.tripId === trip)).toBe(true);
  });

  /**
   * **A same-instant tie is the ordinary case, not a contrivance** (issue
   * #1720). `createBooking` stamps `nowDate()`, the harness freezes it, and two
   * divers seated back to back in one spec therefore share `created_at` to the
   * millisecond by construction. The old tie-break was `bookings.id`, a
   * `defaultRandom()` uuid: one answer per database, a different answer in the
   * next freshly seeded one, and the index of this array is the 01/02 a crew
   * counts down at the rail.
   *
   * The uuids below are **handed in rather than generated**, and the diver who
   * must sort first is given the *higher* one. A test that lets
   * `defaultRandom()` pick agrees with the bug half the time.
   *
   * The names are accented on purpose: `Ángel` sorts before `Zoe` under the
   * ICU collation `people.full_name` carries
   * (`drizzle/20260911200158_person-name-collation`) and *after* it under the
   * byte order PGlite would otherwise default to, so this also pins that the
   * roster inherits the collation without naming it
   * (`src/db/name-collation.test.ts` owns that property itself).
   */
  it("breaks a same-instant tie on the diver's name, whichever way the uuids fall", async () => {
    const { db, shop } = await seededShopContext();
    const [tripA, tripB] = await twoTrips(db, shop.id);
    // The instant `createBooking` would stamp under the frozen test clock.
    const seatedAt = nowDate();
    const ours = new Set<string>();

    const seatPair = async (tripId: string, ids: readonly [string, string]) => {
      const [angelId, zoeId] = ids;
      for (const [name, bookingId] of [
        ["Ángel Ferrer", angelId],
        ["Zoe Adler", zoeId],
      ] as const) {
        const person = await makeDiver(db, shop.id, { name });
        ours.add(person.id);
        await db.insert(bookings).values({
          id: bookingId,
          shopId: shop.id,
          tripId,
          personId: person.id,
          createdAt: seatedAt,
        });
      }
    };

    const namesOn = async (tripId: string) =>
      (await getTripRoster(db, shop.id, tripId))
        .filter((row) => ours.has(row.person.id))
        .map((row) => row.person.fullName);

    // Ángel holds the higher uuid here and the lower one on the other boat.
    await seatPair(tripA, [HIGH_BOOKING_ID, LOW_BOOKING_ID]);
    await seatPair(tripB, [OTHER_LOW_BOOKING_ID, OTHER_HIGH_BOOKING_ID]);

    expect(await namesOn(tripA)).toEqual(["Ángel Ferrer", "Zoe Adler"]);
    expect(await namesOn(tripB)).toEqual(["Ángel Ferrer", "Zoe Adler"]);
    // Read again: an order that is a property of the rows does not move.
    expect(await namesOn(tripA)).toEqual(["Ángel Ferrer", "Zoe Adler"]);
  });

  /**
   * The failure path of the fix above: the name is the *tie-break*, never the
   * key. A roster is oldest-seat-first, and a diver seated at the counter this
   * morning does not jump ahead of the one who booked in March by being called
   * Adler.
   */
  it("keeps seat time above the name, so a later seat does not jump the queue", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await twoTrips(db, shop.id);
    const early = await makeDiver(db, shop.id, { name: "Zoe Adler" });
    const late = await makeDiver(db, shop.id, { name: "Ángel Ferrer" });
    await db.insert(bookings).values({
      shopId: shop.id,
      tripId: trip,
      personId: early.id,
      createdAt: new Date("2026-03-02T10:00:00.000Z"),
    });
    await db.insert(bookings).values({
      shopId: shop.id,
      tripId: trip,
      personId: late.id,
      createdAt: new Date("2026-07-21T09:00:00.000Z"),
    });

    const ours = new Set([early.id, late.id]);
    const roster = (await getTripRoster(db, shop.id, trip)).filter((row) =>
      ours.has(row.person.id),
    );
    expect(roster.map((row) => row.person.fullName)).toEqual(["Zoe Adler", "Ángel Ferrer"]);
  });

  it("answers nothing for another shop's id, even with a real trip id", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await twoTrips(db, shop.id);
    const diver = await makeDiver(db, shop.id);
    await db.insert(bookings).values({ shopId: shop.id, tripId: trip, personId: diver.id });
    expect(await getTripRoster(db, OTHER_SHOP, trip)).toEqual([]);
  });
});

describe("listTripDiverContacts", () => {
  it("names the live people holding active seats, and nobody else", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await twoTrips(db, shop.id);
    const holder = await makeDiver(db, shop.id);
    const cancelled = await makeDiver(db, shop.id);
    const deleted = await makeDiver(db, shop.id, { deleted: true });
    await db.insert(bookings).values([
      { shopId: shop.id, tripId: trip, personId: holder.id },
      { shopId: shop.id, tripId: trip, personId: cancelled.id, status: "cancelled" },
      { shopId: shop.id, tripId: trip, personId: deleted.id },
    ]);

    const contacts = await listTripDiverContacts(db, shop.id, trip);
    expect(contacts).toContainEqual({ fullName: holder.fullName, email: holder.email });
    expect(contacts.map((c) => c.email)).not.toContain(cancelled.email);
    expect(contacts.map((c) => c.email)).not.toContain(deleted.email);
    expect(await listTripDiverContacts(db, OTHER_SHOP, trip)).toEqual([]);
  });
});

describe("the wait list", () => {
  it("stays outside the roster and reads oldest first", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await twoTrips(db, shop.id);
    const first = await makeDiver(db, shop.id);
    const second = await makeDiver(db, shop.id);
    await db
      .insert(tripWaitlistEntries)
      .values({ shopId: shop.id, tripId: trip, personId: first.id });
    await db
      .insert(tripWaitlistEntries)
      .values({ shopId: shop.id, tripId: trip, personId: second.id });

    const waiting = (await getTripWaitlist(db, shop.id, trip)).filter((row) =>
      [first.id, second.id].includes(row.person.id),
    );
    expect(waiting.map((row) => row.person.id)).toEqual([first.id, second.id]);
    const rosterIds = (await getTripRoster(db, shop.id, trip)).map((row) => row.person.id);
    expect(rosterIds).not.toContain(first.id);
    expect(await getTripWaitlist(db, OTHER_SHOP, trip)).toEqual([]);
  });

  it("resolves one entry only under its own trip and shop", async () => {
    const { db, shop } = await seededShopContext();
    const [trip, otherTrip] = await twoTrips(db, shop.id);
    const diver = await makeDiver(db, shop.id);
    const [entry] = await db
      .insert(tripWaitlistEntries)
      .values({ shopId: shop.id, tripId: trip, personId: diver.id })
      .returning({ id: tripWaitlistEntries.id });
    if (!entry) throw new Error("failed to insert wait-list entry");

    const found = await getWaitlistEntryForTrip(db, shop.id, trip, entry.id);
    expect(found?.entry.id).toBe(entry.id);
    expect(found?.person.id).toBe(diver.id);
    expect(await getWaitlistEntryForTrip(db, shop.id, otherTrip, entry.id)).toBeNull();
    expect(await getWaitlistEntryForTrip(db, OTHER_SHOP, trip, entry.id)).toBeNull();
    expect(await getWaitlistEntryForTrip(db, shop.id, trip, OTHER_SHOP)).toBeNull();
  });
});
