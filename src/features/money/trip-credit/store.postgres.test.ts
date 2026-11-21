import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { mergeDiverRecords } from "@/db/diver-merge";
import { createPerson } from "@/db/people";
import { refundBookingOnShopCancellation } from "@/db/refunds";
import { bookings, collectionEntries, tripCreditEntries, trips, userAccounts } from "@/db/schema";
import { anonymizeDiver } from "@/features/records/anonymize";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { tripCreditTestFixture } from "@/test/trip-credit-fixture";
import { grantTripCredit, readTripCredit, redeemTripCredit } from "./store";

/** These tests need CI's existing PostgreSQL service. They never start a server. */
describePostgres("promotional trip credit under contention", () => {
  it("returns equal retries without a second debit after both contenders wait on the departure", async () => {
    const pg = await postgresTestDb();
    const f = await tripCreditTestFixture(pg.db);
    await grantTripCredit(pg.db, f.grant);
    const gate = await holdRowLock(
      pg,
      sql`select id from trips where id = ${f.trip.id} for no key update`,
    );
    const first = redeemTripCredit(pg.connect(), f.redeem);
    const second = redeemTripCredit(pg.connect(), f.redeem);
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    const results = await Promise.all([first, second]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.filter((result) => result.ok && !result.replay)).toHaveLength(1);
    expect(
      await pg.db.select().from(tripCreditEntries).where(eq(tripCreditEntries.kind, "redeem")),
    ).toHaveLength(1);
    expect(await pg.db.select().from(collectionEntries)).toHaveLength(0);
  });
  it("refuses a held beneficiary and lets only one of two different fares consume the balance", async () => {
    const pg = await postgresTestDb();
    const f = await tripCreditTestFixture(pg.db);
    await grantTripCredit(pg.db, f.grant);
    const [otherTrip] = await pg.db
      .insert(trips)
      .values({
        shopId: f.shop.id,
        title: "Second credit fare",
        startsAt: new Date(f.trip.startsAt.getTime() + 86_400_000),
        endsAt: new Date(f.trip.endsAt.getTime() + 86_400_000),
        capacity: 2,
        priceCents: 10_000,
      })
      .returning();
    const [otherBooking] = await pg.db
      .insert(bookings)
      .values({ shopId: f.shop.id, tripId: otherTrip.id, personId: f.diver.id, bookedAs: "diver" })
      .returning();
    const other = { ...f.redeem, attemptId: randomUUID(), bookingId: otherBooking.id };
    // NO KEY UPDATE blocks the money lock while remaining compatible with the
    // journal's FK KEY SHARE; removing the money lock makes this assertion fail.
    const gate = await holdRowLock(
      pg,
      sql`select id from people where id = ${f.diver.id} for no key update`,
    );
    expect(
      await Promise.all([
        redeemTripCredit(pg.connect(), f.redeem),
        redeemTripCredit(pg.connect(), other),
      ]),
    ).toEqual([
      { ok: false, reason: "busy" },
      { ok: false, reason: "busy" },
    ]);
    await gate.release();
    const results = await Promise.all([
      redeemTripCredit(pg.connect(), f.redeem),
      redeemTripCredit(pg.connect(), other),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect((await readTripCredit(pg.db, f.shop.id, f.diver.id, "usd")).balanceCents).toBe(0);
    expect(
      await pg.db.select().from(tripCreditEntries).where(eq(tripCreditEntries.kind, "redeem")),
    ).toHaveLength(1);
  });
  it("rechecks erased beneficiaries after waiting, without debiting anonymous records", async () => {
    const pg = await postgresTestDb();
    const f = await tripCreditTestFixture(pg.db);
    await grantTripCredit(pg.db, f.grant);
    const gate = await holdRowLock(
      pg,
      sql`select id from trips where id = ${f.trip.id} for no key update`,
    );
    const spending = redeemTripCredit(pg.connect(), f.redeem);
    await waitForLockWaiters(pg.db, 1);
    expect(
      await anonymizeDiver(pg.connect(), {
        shopId: f.shop.id,
        personId: f.diver.id,
        actorPersonId: f.actor.id,
      }),
    ).toMatchObject({ ok: true });
    await gate.release();
    expect(await spending).toMatchObject({ ok: false });
    expect(
      await pg.db.select().from(tripCreditEntries).where(eq(tripCreditEntries.kind, "redeem")),
    ).toHaveLength(0);
  });
  it("does not spend the old identity after an audited merge wins the race", async () => {
    const pg = await postgresTestDb();
    const f = await tripCreditTestFixture(pg.db);
    const survivor = await createPerson(pg.db, {
      shopId: f.shop.id,
      fullName: f.diver.fullName,
      email: null,
      phone: null,
      origin: "counter",
    });
    await grantTripCredit(pg.db, f.grant);
    const gate = await holdRowLock(
      pg,
      sql`select id from trips where id = ${f.trip.id} for no key update`,
    );
    const spending = redeemTripCredit(pg.connect(), f.redeem);
    await waitForLockWaiters(pg.db, 1);
    expect(
      await mergeDiverRecords({
        db: pg.connect(),
        shopId: f.shop.id,
        personId: f.diver.id,
        survivorId: survivor.id,
        actorPersonId: f.actor.id,
      }),
    ).toMatchObject({ ok: true });
    await gate.release();
    expect(await spending).toMatchObject({ ok: false, reason: "not_found" });
    expect((await readTripCredit(pg.db, f.shop.id, survivor.id, "usd")).balanceCents).toBe(10_000);
  });
  it("rechecks a disabled staff account after the departure wait", async () => {
    const pg = await postgresTestDb();
    const f = await tripCreditTestFixture(pg.db);
    await grantTripCredit(pg.db, f.grant);
    const gate = await holdRowLock(
      pg,
      sql`select id from trips where id = ${f.trip.id} for no key update`,
    );
    const spending = redeemTripCredit(pg.connect(), f.redeem);
    await waitForLockWaiters(pg.db, 1);
    await pg.db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, f.actor.id));
    await gate.release();
    expect(await spending).toEqual({ ok: false, reason: "not_authorized" });
  });
  it("restores one debit once under contended cancellation refunds", async () => {
    const pg = await postgresTestDb();
    const f = await tripCreditTestFixture(pg.db);
    await grantTripCredit(pg.db, f.grant);
    await redeemTripCredit(pg.db, f.redeem);
    await pg.db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, f.booking.id));
    const gate = await holdRowLock(
      pg,
      sql`select id from bookings where id = ${f.booking.id} for update`,
    );
    const first = refundBookingOnShopCancellation(pg.connect(), {
      shopId: f.shop.id,
      bookingId: f.booking.id,
    });
    const second = refundBookingOnShopCancellation(pg.connect(), {
      shopId: f.shop.id,
      bookingId: f.booking.id,
    });
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    expect(await Promise.all([first, second])).toEqual([
      { status: "credit_returned" },
      { status: "credit_returned" },
    ]);
    expect(
      await pg.db
        .select()
        .from(tripCreditEntries)
        .where(
          and(eq(tripCreditEntries.kind, "restore"), eq(tripCreditEntries.bookingId, f.booking.id)),
        ),
    ).toHaveLength(1);
    expect((await readTripCredit(pg.db, f.shop.id, f.diver.id, "usd")).balanceCents).toBe(10_000);
  });
});
