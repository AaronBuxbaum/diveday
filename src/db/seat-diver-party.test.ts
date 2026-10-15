// @vitest-environment node
import { and, eq, inArray, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { activityEvents, bookings, people, personRoles } from "./schema";
import { seatParty } from "./seat-diver";
import { upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

/** The two seeded departures `seat-diver.test.ts` works against, and a staff actor. */
async function context() {
  const { db, shop } = ctx;
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

async function activityLines(db: AppDb, tripId: string) {
  return await db
    .select({ code: activityEvents.code, params: activityEvents.params })
    .from(activityEvents)
    .where(eq(activityEvents.tripId, tripId));
}

/**
 * **A walk-in family in one pass** (fifth loop, item 9): every member seated
 * on one transaction, the "Under 18" tick on that seat's own row, each seat
 * past the first led by the first, and nothing seated when the boat cannot
 * take them all.
 */
describe("seatParty", () => {
  it("seats the whole party together, with the minor's tick on their own seat", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const stamp = crypto.randomUUID().slice(0, 8);
    const result = await seatParty(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      entry: "walk_in",
      refusals: "specific",
      members: [
        { fullName: `Ana Party ${stamp}`, minor: false },
        { fullName: `Mia Party ${stamp}`, minor: true },
        { fullName: `Leo Party ${stamp}`, minor: false },
      ],
    });
    if (!result.ok) throw new Error(`expected the party to be seated, got ${result.reason}`);
    expect(result.seats.map((seat) => seat.personName)).toEqual([
      `Ana Party ${stamp}`,
      `Mia Party ${stamp}`,
      `Leo Party ${stamp}`,
    ]);

    const rows = await db
      .select({
        id: bookings.id,
        personId: bookings.personId,
        lead: bookings.partyLeadBookingId,
        minor: bookings.minorDeclaredAt,
      })
      .from(bookings)
      .where(
        inArray(
          bookings.id,
          result.seats.map((seat) => seat.bookingId),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const [ana, mia, leo] = result.seats.map((seat) => byId.get(seat.bookingId));
    expect(ana?.lead).toBeNull();
    expect(mia?.lead).toBe(ana?.id);
    expect(leo?.lead).toBe(ana?.id);
    expect(mia?.minor).not.toBeNull();
    expect(ana?.minor).toBeNull();
    expect(leo?.minor).toBeNull();

    // Each seat is owed what one walk-in is: its own line on the trail.
    const lines = await activityLines(db, open.id);
    for (const name of [`Ana Party ${stamp}`, `Mia Party ${stamp}`, `Leo Party ${stamp}`]) {
      expect(JSON.stringify(lines)).toContain(name);
    }
  });

  it("seats nobody when the boat cannot take them all, and says which member it stopped on", async () => {
    const { db, shop, fullTrip, actorPersonId } = await context();
    const stamp = crypto.randomUUID().slice(0, 8);
    const before = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.tripId, fullTrip.id), ne(bookings.status, "cancelled")));
    const result = await seatParty(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      actorPersonId,
      entry: "walk_in",
      refusals: "specific",
      members: [
        { fullName: `Full Party A ${stamp}`, minor: false },
        { fullName: `Full Party B ${stamp}`, minor: true },
      ],
    });
    expect(result).toMatchObject({ ok: false, reason: "trip_full" });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.failedIndex).toBeGreaterThanOrEqual(0);
    const after = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.tripId, fullTrip.id), ne(bookings.status, "cancelled")));
    expect(after).toHaveLength(before.length);
  });
});
