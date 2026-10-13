import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { createBookingParty } from "./bookings";
import type { AppDb } from "./client";
import { bookings, shops } from "./schema";
import { lockSeatDeparture } from "./seat-locks";
import { createTrip } from "./trips";

/**
 * `lockSeatDeparture` is the lock order three counter paths depend on against
 * the #2324 deadlock (`check-in.ts`, `no-show.ts`, `manifests.ts`): **the
 * departure, then the seat**. `seat-lock-order.postgres.test.ts` races those
 * callers; this file pins the helper itself.
 */

async function seatOn(db: AppDb, shopId: string) {
  const startsAt = new Date(Date.UTC(2031, 4, 12, 13));
  const trip = await createTrip(db, {
    shopId,
    title: "Seat lock",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: 6,
  });
  if (!trip) throw new Error("trip not created");
  const party = await createBookingParty(db, [
    { actor: "staff" as const, shopId, tripId: trip.id, fullName: "Lock Diver" },
  ]);
  if (!party.ok) throw new Error(`seat refused: ${party.reason}`);
  return { tripId: trip.id, bookingId: party.bookings[0].bookingId };
}

describe("lockSeatDeparture", () => {
  const ctx = fileScopedShopContext();

  it("returns the departure the seat is on", async () => {
    const { db, shop } = ctx;
    const seat = await seatOn(db, shop.id);
    expect(await lockSeatDeparture(db, shop.id, seat.bookingId)).toBe(seat.tripId);
  });

  it("finds no seat in another shop, and none that does not exist", async () => {
    const { db, shop } = ctx;
    const seat = await seatOn(db, shop.id);
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-seat-locks", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    expect(await lockSeatDeparture(db, other.id, seat.bookingId)).toBeNull();
    expect(await lockSeatDeparture(db, shop.id, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

/**
 * The statements parked on a lock. A row-lock waiter waits on the holder's
 * transaction id, not on a relation, so the statement is what names the row.
 */
async function waitingStatements(db: AppDb): Promise<string[]> {
  const result = await db.execute(sql`
    select query
      from pg_stat_activity
     where datname = current_database()
       and wait_event_type = 'Lock'
  `);
  const rows = Array.isArray(result) ? result : (result as { rows: unknown[] }).rows;
  return (rows as { query: string }[]).map((row) => row.query);
}

describePostgres("lockSeatDeparture on a real server", () => {
  async function fixture() {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: "Lock Reef", slug: "lock-reef", timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop insert failed");
    return { pg, shopId: shop.id, ...(await seatOn(pg.db, shop.id)) };
  }

  it("serializes two counter actions on one seat at the departure, before either holds the seat", async () => {
    const { pg, shopId, bookingId } = await fixture();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstHolds = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      firstLocked = resolve;
    });
    const counterAction = (name: string, hold?: Promise<void>) =>
      pg.connect().transaction(async (tx) => {
        await lockSeatDeparture(tx, shopId, bookingId);
        order.push(`${name}: departure`);
        await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for("update");
        order.push(`${name}: seat`);
        if (hold) {
          firstLocked();
          await hold;
        }
      });

    const first = counterAction("first", firstHolds);
    await locked;
    const second = counterAction("second");
    try {
      await waitForLockWaiters(pg.db, 1);
      // The second action is parked on the departure, not the seat: it holds
      // nothing the first could ever need, so the two cannot deadlock.
      const parked = await waitingStatements(pg.db);
      expect(parked).toHaveLength(1);
      expect(parked[0]).toMatch(/from "trips".*for no key update/s);
      expect(order).toEqual(["first: departure", "first: seat"]);
    } finally {
      releaseFirst();
      await Promise.all([first, second]);
    }
    expect(order).toEqual(["first: departure", "first: seat", "second: departure", "second: seat"]);
  });

  it("does not block the KEY SHARE a roll-call insert takes on the departure", async () => {
    const { pg, shopId, tripId, bookingId } = await fixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired!: () => void;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const holder = pg.connect().transaction(async (tx) => {
      await lockSeatDeparture(tx, shopId, bookingId);
      acquired();
      await held;
    });
    await locked;
    // The foreign-key check of an insert referencing the trip, as a statement.
    const shared = await pg
      .connect()
      .execute(sql`select id from trips where id = ${tripId} for key share nowait`);
    const rows = Array.isArray(shared) ? shared : (shared as { rows: unknown[] }).rows;
    expect(rows).toHaveLength(1);
    release();
    await holder;
  });
});
