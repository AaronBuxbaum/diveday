import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { issueBookingCapability, issueReturningDiverReceipt } from "./booking-capabilities";
import { bookingCapabilities, bookings, people, shops, trips } from "./schema";

describePostgres("returning-diver receipt lock bounds", () => {
  it("refuses a held person-row lock instead of waiting on the committed booking", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Receipt lock ${suffix}`, slug: `receipt-lock-${suffix}`, timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop insert returned no row");
    const now = nowDate();
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Receipt lock test",
        startsAt: new Date(now.getTime() + 48 * HOUR_MS),
        endsAt: new Date(now.getTime() + 52 * HOUR_MS),
        capacity: 2,
      })
      .returning();
    if (!trip) throw new Error("trip insert returned no row");
    const [person] = await pg.db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Receipt Lock Diver",
        email: `receipt-${suffix}@example.com`,
      })
      .returning();
    if (!person) throw new Error("person insert returned no row");
    const [booking] = await pg.db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
      .returning();
    if (!booking) throw new Error("booking insert returned no row");
    const redirect = await issueBookingCapability(pg.db, {
      shopId: shop.id,
      bookingId: booking.id,
      purpose: "readiness",
      expectedPersonId: person.id,
      expectedTripId: trip.id,
      now,
    });
    if (!redirect) throw new Error("readiness capability insert returned no row");

    const lock = await holdRowLock(
      pg,
      sql`select id from people where id = ${person.id} for update`,
    );
    const startedAt = performance.now();
    const issuance = issueReturningDiverReceipt(pg.db, {
      shopId: shop.id,
      bookingId: booking.id,
      expectedPersonId: person.id,
      expectedTripId: trip.id,
      redirectReadinessToken: redirect.token,
      now,
    });
    try {
      await waitForLockWaiters(pg.db, 1, 2_000);
      const outcome = await Promise.race([
        issuance.then(
          () => "completed" as const,
          () => "refused" as const,
        ),
        new Promise<"unbounded">((resolve) => setTimeout(() => resolve("unbounded"), 2_000)),
      ]);
      expect(outcome).toBe("refused");
      expect(performance.now() - startedAt).toBeLessThan(1_500);
      const receipts = await pg.db
        .select({ id: bookingCapabilities.id })
        .from(bookingCapabilities)
        .where(
          sql`${bookingCapabilities.bookingId} = ${booking.id} and ${bookingCapabilities.purpose} = 'returning_diver_receipt'`,
        );
      expect(receipts).toHaveLength(0);
    } finally {
      await lock.release();
      await issuance.catch(() => undefined);
    }
  });
});
