import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { raceShop } from "@/test/postgres-shop";
import { createBooking } from "./bookings";
import { askForDeparture } from "./leads";
import { leads, people, trips } from "./schema";

/**
 * One diver joining a full departure's wait list twice at once, a double tap on
 * a slow phone (fourth review, row 33). `askForDeparture` takes the trip row
 * before it finds or creates the person and checks for an entry, so the second
 * join sees the first. Without the lock both create the person (no email
 * uniqueness stops two rows) and both add a lead: two leads for one diver.
 *
 * The gate is `for no key update`, not `for update`, so the lead insert's
 * foreign-key `KEY SHARE` on the trip does not park on it: only the join's own
 * lock does. With that lock removed nothing parks and the test fails at the
 * gate, which is the line that holds the lock to account here.
 */

describePostgres("askForDeparture under real concurrency", () => {
  it("adds one lead for one diver joining twice at once", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db, "Waitlist Reef");
    const startsAt = new Date(nowDate().getTime() + 48 * HOUR_MS);
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Full Wreck",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
        capacity: 1,
      })
      .returning();
    if (!trip) throw new Error("trip insert returned no row");
    const seat = await createBooking(pg.db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "First Aboard",
      email: "first@example.com",
    });
    if (!seat.ok) throw new Error(`seat refused: ${seat.reason}`);

    const gate = await holdRowLock(
      pg,
      sql`select id from trips where id = ${trip.id} for no key update`,
    );
    const joins = [pg.connect(), pg.connect()].map((db) =>
      askForDeparture(db, {
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Nora Quinn",
        email: "nora@example.com",
      }),
    );
    await waitForLockWaiters(pg.db, joins.length);
    await gate.release();

    const outcomes = await Promise.all(joins);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.find((outcome) => !outcome.ok)).toMatchObject({ reason: "already_waitlisted" });
    const rows = await pg.db.select({ id: leads.id }).from(leads).where(eq(leads.tripId, trip.id));
    expect(rows).toHaveLength(1);
    const noras = await pg.db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, "nora@example.com")));
    expect(noras).toHaveLength(1);
  });
});
