import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { issueBookingCapability, revokeBookingCapabilities } from "@/db/booking-capabilities";
import { expireGroupHolds } from "@/db/bookings";
import { bookings, tripCreditEntries, trips } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { tripCreditTestFixture } from "@/test/trip-credit-fixture";
import { redeemOwnTripCredit } from "./self-service";
import { grantTripCredit } from "./store";

describePostgres("self-service credit under contention", () => {
  it.each(["sweep", "redemption"] as const)(
    "preserves the winning %s when expiry and redemption contend",
    async (winner) => {
      const pg = await postgresTestDb();
      const f = await tripCreditTestFixture(pg.db);
      await grantTripCredit(pg.db, f.grant);
      const deadline = new Date(nowDate().getTime() + (winner === "sweep" ? -1000 : 1000));
      await pg.db
        .update(bookings)
        .set({ groupHoldUntil: deadline })
        .where(eq(bookings.id, f.booking.id));
      const link = await issueBookingCapability(pg.db, {
        shopId: f.shop.id,
        bookingId: f.booking.id,
        purpose: "readiness",
        delivered: true,
      });
      if (!link) throw new Error("missing link");
      const gate = await holdRowLock(
        pg,
        sql`select id from trips where id = ${f.trip.id} for no key update`,
      );
      const spend = () =>
        redeemOwnTripCredit(pg.connect(), {
          token: link.token,
          attemptId: randomUUID(),
          currency: "usd",
          expectedFareCents: 10_000,
        });
      const sweep = () => expireGroupHolds(pg.connect(), new Date(deadline.getTime() + 1000));
      let spending: ReturnType<typeof spend>;
      let sweeping: ReturnType<typeof sweep>;
      try {
        if (winner === "sweep") {
          sweeping = sweep();
          await waitForLockWaiters(pg.db, 1);
          spending = spend();
        } else {
          spending = spend();
          await waitForLockWaiters(pg.db, 1);
          sweeping = sweep();
        }
        await waitForLockWaiters(pg.db, 2);
      } finally {
        await gate.release();
      }
      const [spent, expired] = await Promise.all([spending, sweeping]);
      expect(spent.ok).toBe(winner === "redemption");
      expect(expired).toBe(winner === "sweep" ? 1 : 0);
      expect(
        await pg.db.select().from(tripCreditEntries).where(eq(tripCreditEntries.kind, "redeem")),
      ).toHaveLength(winner === "redemption" ? 1 : 0);
    },
  );

  it("does not debit after revocation wins while the departure is locked", async () => {
    const pg = await postgresTestDb();
    const f = await tripCreditTestFixture(pg.db);
    await grantTripCredit(pg.db, f.grant);
    const link = await issueBookingCapability(pg.db, {
      shopId: f.shop.id,
      bookingId: f.booking.id,
      purpose: "readiness",
      delivered: true,
    });
    if (!link) throw new Error("missing link");
    const gate = await holdRowLock(
      pg,
      sql`select id from trips where id = ${f.trip.id} for no key update`,
    );
    const spend = redeemOwnTripCredit(pg.connect(), {
      token: link.token,
      attemptId: randomUUID(),
      currency: "usd",
      expectedFareCents: 10_000,
    });
    try {
      await waitForLockWaiters(pg.db, 1);
      await revokeBookingCapabilities(pg.db, { shopId: f.shop.id, bookingId: f.booking.id });
    } finally {
      await gate.release();
    }
    expect(await spend).toMatchObject({ ok: false });
    expect(
      await pg.db.select().from(tripCreditEntries).where(eq(tripCreditEntries.kind, "redeem")),
    ).toHaveLength(0);
  });

  it("spends a single balance at most once across two delivered bookings", async () => {
    const pg = await postgresTestDb();
    const f = await tripCreditTestFixture(pg.db);
    await grantTripCredit(pg.db, f.grant);
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: f.shop.id,
        title: "Second fare",
        startsAt: new Date(f.trip.startsAt.getTime() + 86_400_000),
        endsAt: new Date(f.trip.endsAt.getTime() + 86_400_000),
        capacity: 2,
        priceCents: 10_000,
      })
      .returning();
    const [booking] = await pg.db
      .insert(bookings)
      .values({ shopId: f.shop.id, tripId: trip.id, personId: f.diver.id, bookedAs: "diver" })
      .returning();
    const first = await issueBookingCapability(pg.db, {
      shopId: f.shop.id,
      bookingId: f.booking.id,
      purpose: "readiness",
      delivered: true,
    });
    const second = await issueBookingCapability(pg.db, {
      shopId: f.shop.id,
      bookingId: booking.id,
      purpose: "readiness",
      delivered: true,
    });
    if (!first || !second) throw new Error("missing links");
    const spend = (token: string) =>
      redeemOwnTripCredit(pg.connect(), {
        token,
        attemptId: randomUUID(),
        currency: "usd",
        expectedFareCents: 10_000,
      });
    const results = await Promise.all([spend(first.token), spend(second.token)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await pg.db.select().from(tripCreditEntries).where(eq(tripCreditEntries.kind, "redeem")),
    ).toHaveLength(1);
  });
});
