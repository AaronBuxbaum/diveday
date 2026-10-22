import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { createBooking, moveBooking } from "./bookings";
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
    // Hold the real move inside its own transaction, after its trip/seat locks
    // and before the changed departure commits. No transaction-as-database cast.
    await pg.db.execute(sql`
      create function gate_staff_booking_move() returns trigger language plpgsql as $$
      begin
        perform pg_advisory_xact_lock(2915);
        return new;
      end;
      $$
    `);
    await pg.db.execute(sql`
      create trigger gate_staff_booking_move before update on bookings
      for each row when (new.trip_id is distinct from old.trip_id)
      execute function gate_staff_booking_move()
    `);
    const gate = await holdRowLock(pg, sql`select pg_advisory_xact_lock(2915)`);
    const staffMove = moveBooking(pg.connect(), {
      shopId: shop.id,
      bookingId: seat.bookingId,
      fromTripId: from.id,
      toTripId: to.id,
    });
    let request: ReturnType<typeof recordMoveAsk> | undefined;
    try {
      await waitForLockWaiters(pg.db, 1);
      request = recordMoveAsk(pg.connect(), {
        shopId: shop.id,
        bookingId: seat.bookingId,
        expectedTripId: from.id,
        note: "A note about the original date",
        now: nowDate(),
      });
      // Both the move's trigger and the request's departure lock are parked.
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    expect(await staffMove).toMatchObject({ ok: true });
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
