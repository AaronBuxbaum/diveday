import { eq } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { createBooking, moveBooking } from "./bookings";
import type { AppDb } from "./client";
import { hasMoveAsk, recordMoveAsk } from "./inbound-messages";
import { bookings, inboundMessages, shops } from "./schema";
import { createTrip } from "./trips";

/** #2864: the expected departure is checked after a concurrent staff move commits. */
describePostgres("a move request racing a staff move", () => {
  it("refuses the old departure after waiting for the staff move", async () => {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({
        name: "Move Request Reef",
        slug: "move-request-reef",
        timezone: "UTC",
      })
      .returning();
    if (!shop) throw new Error("shop insert failed");
    const startsAt = new Date(nowMs() + 5 * 86_400_000);
    const from = await createTrip(pg.db, {
      shopId: shop.id,
      title: "Original date",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      capacity: 6,
    });
    const to = await createTrip(pg.db, {
      shopId: shop.id,
      title: "Replacement date",
      startsAt: new Date(startsAt.getTime() + 86_400_000),
      endsAt: new Date(startsAt.getTime() + 90_000_000),
      capacity: 6,
    });
    if (!from || !to) throw new Error("trips not created");
    const seat = await createBooking(pg.db, {
      actor: "staff",
      shopId: shop.id,
      tripId: from.id,
      fullName: "Move Request Diver",
    });
    if (!seat.ok) throw new Error(`seat refused: ${seat.reason}`);
    const moved = Promise.withResolvers<void>();
    const commit = Promise.withResolvers<void>();
    onTestFinished(() => commit.resolve());
    const staffMove = pg.connect().transaction(async (tx) => {
      const outcome = await moveBooking(tx as AppDb, {
        shopId: shop.id,
        bookingId: seat.bookingId,
        fromTripId: from.id,
        toTripId: to.id,
      });
      expect(outcome).toMatchObject({ ok: true });
      moved.resolve();
      await commit.promise;
    });
    await Promise.race([moved.promise, staffMove]);
    const request = recordMoveAsk(pg.connect(), {
      shopId: shop.id,
      bookingId: seat.bookingId,
      expectedTripId: from.id,
      note: "A note about the original date",
      now: nowDate(),
    });
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      commit.resolve();
    }
    await staffMove;
    expect(await request).toEqual({ status: "not_found" });
    expect(await hasMoveAsk(pg.db, shop.id, seat.bookingId)).toBe(false);
    const [current] = await pg.db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(eq(bookings.id, seat.bookingId));
    expect(current?.tripId).toBe(to.id);
    const requests = await pg.db
      .select()
      .from(inboundMessages)
      .where(eq(inboundMessages.bookingId, seat.bookingId));
    expect(requests).toHaveLength(0);
  });
});
