import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
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

let seq = 0;

async function makeDiver(db: AppDb, shopId: string, opts: { deleted?: boolean } = {}) {
  seq += 1;
  const [person] = await db
    .insert(people)
    .values({
      shopId,
      fullName: `Diver ${seq}`,
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
