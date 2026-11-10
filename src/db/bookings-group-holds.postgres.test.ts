import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { createBooking, createBookingParty, expireGroupHolds } from "./bookings";
import { bookings, shops, trips } from "./schema";
import { seatHeld } from "./trips-queries";

describePostgres("group hold expiry under real contention", () => {
  it("releases due holds before concurrent replacement bookings count capacity", async () => {
    const pg = await postgresTestDb();
    const now = nowDate();
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: "Group race", slug: "group-hold-race", timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop missing");
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Held departure",
        capacity: 2,
        startsAt: new Date(now.getTime() + 72 * 3_600_000),
        endsAt: new Date(now.getTime() + 76 * 3_600_000),
      })
      .returning();
    if (!trip) throw new Error("departure missing");
    const party = await createBookingParty(
      pg.db,
      [
        {
          actor: "public",
          shopId: shop.id,
          tripId: trip.id,
          fullName: "Organizer",
          email: "race-organizer@example.com",
        },
        { actor: "public", shopId: shop.id, tripId: trip.id, fullName: "Companion" },
      ],
      { holdUntil: new Date(now.getTime() + 3_600_000) },
    );
    expect(party.ok).toBe(true);
    await pg.db
      .update(bookings)
      .set({ groupHoldUntil: now })
      .where(and(eq(bookings.shopId, shop.id), eq(bookings.tripId, trip.id)));
    const gate = await holdRowLock(pg, sql`select id from trips where id = ${trip.id} for update`);
    const sweep = expireGroupHolds(pg.connect(), now);
    const contenders = [1, 2, 3].map((n) =>
      createBooking(pg.connect(), {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: `Replacement ${n}`,
      }),
    );
    await waitForLockWaiters(pg.db, 4);
    await gate.release();
    await sweep;
    const outcomes = await Promise.all(contenders);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(2);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([{ ok: false, reason: "trip_full" }]);
    const held = await pg.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.shopId, shop.id), eq(bookings.tripId, trip.id), seatHeld));
    expect(held).toHaveLength(2);
  });
});
