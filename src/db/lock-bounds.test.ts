import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { lockSeatsInOrder } from "./checkouts";
import type { AppDb } from "./client";
import * as bounds from "./lock-bounds";
import { setBookingPayment } from "./payments";
import { lockSeatDeparture } from "./seat-locks";
import { createTrip } from "./trips";

vi.mock("./lock-bounds", async (importOriginal) => {
  const real = await importOriginal<typeof import("./lock-bounds")>();
  return { ...real, boundLockWaits: vi.fn(real.boundLockWaits) };
});

async function lockTimeout(db: AppDb): Promise<string> {
  const result = await db.execute(sql`show lock_timeout`);
  const rows = Array.isArray(result) ? result : (result as { rows: unknown[] }).rows;
  return (rows[0] as { lock_timeout: string }).lock_timeout;
}

async function seat(db: AppDb, shopId: string) {
  const startsAt = new Date(Date.UTC(2031, 5, 3, 13));
  const trip = await createTrip(db, {
    shopId,
    title: "Bounded",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: 4,
  });
  if (!trip) throw new Error("trip not created");
  const party = await createBookingParty(db, [
    { actor: "staff" as const, shopId, tripId: trip.id, fullName: "Bounded Diver" },
  ]);
  if (!party.ok) throw new Error(`seat refused: ${party.reason}`);
  return party.bookings[0].bookingId;
}

describe("boundLockWaits", () => {
  const ctx = fileScopedShopContext();
  const spy = vi.mocked(bounds.boundLockWaits);

  beforeEach(async () => {
    // Every test runs inside one transaction; start each from the server default.
    await ctx.db.execute(sql`set local lock_timeout = 0`);
    spy.mockClear();
  });

  it("sets the transaction's lock_timeout to five seconds", async () => {
    expect(await lockTimeout(ctx.db)).toBe("0");
    await bounds.boundLockWaits(ctx.db);
    expect(await lockTimeout(ctx.db)).toBe("5s");
  });

  it("is applied by the booking transaction", async () => {
    await seat(ctx.db, ctx.shop.id);
    expect(spy).toHaveBeenCalled();
    expect(await lockTimeout(ctx.db)).toBe("5s");
  });

  it("is applied by lockSeatDeparture, the counter's seat lock", async () => {
    const bookingId = await seat(ctx.db, ctx.shop.id);
    await ctx.db.execute(sql`set local lock_timeout = 0`);
    await lockSeatDeparture(ctx.db, ctx.shop.id, bookingId);
    expect(await lockTimeout(ctx.db)).toBe("5s");
  });

  it("is applied by lockSeatsInOrder, the checkout's seat lock", async () => {
    const bookingId = await seat(ctx.db, ctx.shop.id);
    await ctx.db.execute(sql`set local lock_timeout = 0`);
    await ctx.db.transaction(async (tx) => {
      await lockSeatsInOrder(tx, [bookingId]);
      expect(await lockTimeout(tx as unknown as AppDb)).toBe("5s");
    });
  });

  it("is applied by the payment lock every booking_payments write takes", async () => {
    const bookingId = await seat(ctx.db, ctx.shop.id);
    spy.mockClear();
    await setBookingPayment(ctx.db, {
      shopId: ctx.shop.id,
      bookingId,
      status: "paid",
      amountCents: 10_000,
      currency: "usd",
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("is named in the tip and refund transactions that hold a seat across Stripe", () => {
    // Both need a connected Stripe account to reach; the call is pinned by name.
    for (const file of ["tips.ts", "refunds.ts"]) {
      const source = readFileSync(path.join(process.cwd(), "src/db", file), "utf8");
      expect(source, file).toMatch(/await boundLockWaits\(tx\);/);
    }
  });
});
