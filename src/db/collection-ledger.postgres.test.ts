import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { closePricingMonth } from "@/features/pricing-volume";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import type { AppDb } from "./client";
import { recordCollectionBalance } from "./collection-ledger";
import { setBookingPayment } from "./payments";
import {
  bookings,
  collectionEntries,
  paymentOperationIntents,
  people,
  pricingVolumeStatements,
  shops,
  trips,
} from "./schema";

async function fixture(db: AppDb) {
  const [shop] = await db
    .insert(shops)
    .values({
      name: "Concurrent Collections",
      slug: `collection-${randomBytes(5).toString("hex")}`,
      timezone: "UTC",
    })
    .returning();
  if (!shop) throw new Error("shop missing");
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Payer" })
    .returning();
  if (!person) throw new Error("person missing");
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Reef",
      startsAt: new Date("2026-08-10T12:00:00Z"),
      endsAt: new Date("2026-08-10T15:00:00Z"),
      capacity: 8,
    })
    .returning();
  if (!trip) throw new Error("trip missing");
  const [booking] = await db
    .insert(bookings)
    .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
    .returning();
  if (!booking) throw new Error("booking missing");
  return { shop, booking };
}

describePostgres("collection billing under real contention", () => {
  it("deduplicates concurrent receipt reconciliation under the source-row lock", async () => {
    const pg = await postgresTestDb();
    const { shop, booking } = await fixture(pg.db);
    const gate = await holdRowLock(
      pg,
      sql`select id from bookings where id = ${booking.id} for update`,
    );
    const input = {
      shopId: shop.id,
      sourceType: "booking" as const,
      sourceId: booking.id,
      currency: "usd",
      method: "cash",
      balanceCents: 10_000,
      evidence: {},
    };
    const first = pg.connect().transaction((tx) => recordCollectionBalance(tx, input));
    const second = pg.connect().transaction((tx) => recordCollectionBalance(tx, input));
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    await Promise.all([first, second]);
    expect(await pg.db.select().from(collectionEntries)).toHaveLength(1);
  });

  it("closes one immutable statement under simultaneous cron runs", async () => {
    const pg = await postgresTestDb();
    const { shop, booking } = await fixture(pg.db);
    await setBookingPayment(pg.db, {
      shopId: shop.id,
      bookingId: booking.id,
      currency: "usd",
      status: "paid",
      amountCents: 10_000,
      method: "cash",
    });
    const gate = await holdRowLock(pg, sql`select id from shops where id = ${shop.id} for update`);
    const input = {
      shopId: shop.id,
      month: { year: 2026, month: 7 },
      timeZone: "UTC",
      terms: { plan: "percent_of_volume" as const, monthlyCents: 0, basisPoints: 300 },
      freeUntil: null,
      now: new Date("2026-08-02T12:00:00Z"),
    };
    const first = closePricingMonth(pg.connect(), input);
    const second = closePricingMonth(pg.connect(), input);
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.id).toBe(b.id);
    expect(a.feeCents).toBe(300);
    expect(await pg.db.select().from(pricingVolumeStatements)).toHaveLength(1);
  });

  it("refuses a manual receipt after a concurrent refund claim commits under the seat lock", async () => {
    const pg = await postgresTestDb();
    const { shop, booking } = await fixture(pg.db);
    const deposit = await setBookingPayment(pg.db, {
      shopId: shop.id,
      bookingId: booking.id,
      currency: "usd",
      status: "deposit_paid",
      amountCents: 5_000,
      provider: "stripe",
      providerRef: "cs_claimed",
    });
    if (!deposit) throw new Error("missing payment");
    const gate = await holdRowLock(
      pg,
      sql`select id from bookings where id = ${booking.id} for update`,
    );
    const claim = pg.connect().transaction(async (tx) => {
      await tx.execute(sql`select id from bookings where id = ${booking.id} for update`);
      await tx
        .insert(paymentOperationIntents)
        .values({ shopId: shop.id, bookingId: booking.id, kind: "refund", status: "started" });
    });
    await waitForLockWaiters(pg.db, 1);
    const receipt = setBookingPayment(pg.connect(), {
      shopId: shop.id,
      bookingId: booking.id,
      currency: "usd",
      status: "paid",
      amountCents: 12_000,
      manualHeldCents: 7_000,
      provider: "mixed",
      providerRef: "cs_claimed",
      method: "cash",
      expectedPaymentEntryId: deposit.id,
    });
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    await claim;
    expect(await receipt).toBeNull();
    expect(await pg.db.select().from(collectionEntries)).toHaveLength(0);
  });

  it("a repeated stale cash balance wins once without erasing its Stripe deposit", async () => {
    const pg = await postgresTestDb();
    const { shop, booking } = await fixture(pg.db);
    const deposit = await setBookingPayment(pg.db, {
      shopId: shop.id,
      bookingId: booking.id,
      currency: "usd",
      status: "deposit_paid",
      amountCents: 5_000,
      provider: "stripe",
      providerRef: "cs_concurrent",
    });
    if (!deposit) throw new Error("payment missing");
    const gate = await holdRowLock(
      pg,
      sql`select id from bookings where id = ${booking.id} for update`,
    );
    const input = {
      shopId: shop.id,
      bookingId: booking.id,
      currency: "usd",
      status: "paid" as const,
      amountCents: 12_000,
      manualHeldCents: 7_000,
      provider: "mixed",
      providerRef: "cs_concurrent",
      method: "cash" as const,
      expectedPaymentEntryId: deposit.id,
    };
    const first = setBookingPayment(pg.connect(), input);
    const second = setBookingPayment(pg.connect(), input);
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    expect((await Promise.all([first, second])).filter(Boolean)).toHaveLength(1);
    const cash = await pg.db
      .select()
      .from(collectionEntries)
      .where(eq(collectionEntries.sourceType, "booking"));
    expect(cash.map((row) => row.amountCents)).toEqual([7_000]);
  });
});
