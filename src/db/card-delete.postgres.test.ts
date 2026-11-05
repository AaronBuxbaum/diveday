import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { MINUTE_MS, nowMs } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { cancelBooking, createBooking, restoreBooking } from "./bookings";
import { deleteCertification } from "./readiness";
import { bookings, cards, courses, people } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { createTrip, listStaff, setTripCrew } from "./trips";

/**
 * **A card Delete waits for the seat write that read the card** (issue #3839).
 * The restore reads the student's level card under the trip lock, then writes
 * the seat back. A gate on that write holds the restore after its read; the
 * delete, started while it waits, must not commit until the restore has, or a
 * student gets back onto a session on a card that was deleted in between.
 */
describePostgres("a card delete and an undone removal", () => {
  it("serializes the delete behind a restore that already read the card", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const [course] = await pg.db
      .select()
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.title, "Advanced Open Water Diver")));
    const instructor = (await listStaff(pg.db, shop.id)).find((entry) =>
      entry.roles.includes("instructor"),
    );
    if (!course || !instructor) throw new Error("course or instructor missing");
    const startsAt = nowMs() + 200 * 24 * 60 * MINUTE_MS;
    const trip = await createTrip(pg.db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Advanced Open Water — card delete race",
      startsAt: new Date(startsAt),
      endsAt: new Date(startsAt + 4 * 60 * MINUTE_MS),
      capacity: 12,
      plannedDives: 2,
    });
    if (!trip || !(await setTripCrew(pg.db, shop.id, trip.id, [instructor.person.id]))) {
      throw new Error("session not created");
    }
    const [student] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Race Student", email: "race-student@example.com" })
      .returning();
    if (!student) throw new Error("student missing");
    const [card] = await pg.db
      .insert(cards)
      .values({
        kind: "level",
        shopId: shop.id,
        personId: student.id,
        agency: "padi",
        level: "open_water",
        identifier: "RACE-CARD",
        status: "verified",
      })
      .returning({ id: cards.id });
    if (!card) throw new Error("card missing");
    const booked = await createBooking(pg.db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      personId: student.id,
    });
    if (!booked.ok) throw new Error(`student refused at the sale: ${booked.reason}`);
    await cancelBooking(pg.db, shop.id, booked.bookingId);

    // Holds the restore after it read the card, at the write that puts the seat back.
    await pg.db.execute(
      sql`create function gate_seat_restore() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(73839); return new; end $$`,
    );
    await pg.db.execute(
      sql`create trigger gate_seat_restore before update on bookings for each row execute function gate_seat_restore()`,
    );
    const gate = await holdRowLock(pg, sql`select pg_advisory_xact_lock(73839)`);
    const restoring = restoreBooking(pg.connect(), shop.id, booked.bookingId);
    let deleting: Promise<boolean> | undefined;
    try {
      // The restore is parked on the gate.
      await waitForLockWaiters(pg.db, 1);
      deleting = deleteCertification(pg.connect(), {
        shopId: shop.id,
        certificationId: card.id,
        deletedByPersonId: instructor.person.id,
      });
      // The delete is parked too, on the departure the restore holds: it has not committed.
      await waitForLockWaiters(pg.db, 2);
      const [midway] = await pg.db
        .select({ deletedAt: cards.deletedAt })
        .from(cards)
        .where(eq(cards.id, card.id));
      expect(midway?.deletedAt).toBeNull();
    } finally {
      await gate.release();
    }
    // The restore read the card before the delete, so it stands; the delete follows it.
    expect(await restoring).toBe("restored");
    expect(await deleting).toBe(true);
    const [seat] = await pg.db
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, booked.bookingId));
    expect(seat?.status).toBe("booked");
    const [after] = await pg.db
      .select({ deletedAt: cards.deletedAt })
      .from(cards)
      .where(eq(cards.id, card.id));
    expect(after?.deletedAt).not.toBeNull();
  });
});
