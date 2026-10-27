import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { issueBookingCapability, verifyBookingCapability } from "./booking-capabilities";
import { bookingCapabilities, bookings, people, shops, trips } from "./schema";

describePostgres("capability issuance and erasure serialization", () => {
  it("does not mint after an erasure already holds the subject lock", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Erasure race ${suffix}`, slug: `erasure-race-${suffix}`, timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop insert returned no row");
    const now = nowDate();
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Race test",
        startsAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
        endsAt: new Date(now.getTime() + 52 * 60 * 60 * 1000),
        capacity: 1,
      })
      .returning();
    if (!trip) throw new Error("trip insert returned no row");
    const [person] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Race Diver", email: `race-${suffix}@example.com` })
      .returning();
    if (!person) throw new Error("person insert returned no row");
    const [booking] = await pg.db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
      .returning();
    if (!booking) throw new Error("booking insert returned no row");
    const existing = await issueBookingCapability(pg.db, {
      shopId: shop.id,
      bookingId: booking.id,
      purpose: "readiness",
      now,
    });
    if (!existing) throw new Error("initial capability insert returned no row");

    let releaseGate!: () => void;
    let signalUpdated!: () => void;
    const waitForRelease = new Promise<void>((resolve) => (releaseGate = resolve));
    const updated = new Promise<void>((resolve) => (signalUpdated = resolve));
    const gateDb = pg.connect();
    let mint: ReturnType<typeof issueBookingCapability> | undefined;
    const erasureAt = new Date(now.getTime() + 1);
    const gate = gateDb.transaction(async (tx) => {
      await tx
        .update(people)
        .set({ anonymizedAt: erasureAt, deletedAt: erasureAt })
        .where(eq(people.id, person.id));
      signalUpdated();
      await waitForRelease;
    });
    try {
      await updated;
      mint = issueBookingCapability(pg.db, {
        shopId: shop.id,
        bookingId: booking.id,
        purpose: "readiness",
        now,
      });
      await waitForLockWaiters(pg.db, 1);
      releaseGate();
      await gate;
      expect(await mint).toBeNull();
      expect(
        await verifyBookingCapability(pg.db, { token: existing.token, purpose: "readiness", now }),
      ).toBeNull();
      const capabilities = await pg.db
        .select()
        .from(bookingCapabilities)
        .where(eq(bookingCapabilities.bookingId, booking.id));
      expect(capabilities).toHaveLength(1);
    } finally {
      releaseGate();
      await gate;
      await mint?.catch(() => undefined);
    }
  });
});
