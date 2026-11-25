import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { AppDb } from "@/db/client";
import { createPerson } from "@/db/people";
import {
  bookingReferrals,
  bookings,
  people,
  rollCallEvents,
  shops,
  tripCreditEntries,
  trips,
} from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { buddyCreditEntryId } from "@/lib/trip-credit";
import { fileScopedShopContext } from "@/test/db";
import { tripCreditTestFixture } from "@/test/trip-credit-fixture";
import { BUDDY_CREDIT_SWEEP_LIMIT, grantBuddyCredits } from "./buddy-credit";
import { grantTripCredit, readTripCredit } from "./store";

const ctx = fileScopedShopContext();
const DAY = 86_400_000;

/** Insert a real database change between the candidate read and its transaction. */
function beforeGrantTransaction(db: AppDb, before: () => Promise<unknown>): AppDb {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "transaction") {
        return async (...args: Parameters<AppDb["transaction"]>) => {
          await before();
          return target.transaction(...args);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

/**
 * A referrer (the fixture's diver, on its own upcoming seat), a friend who
 * booked through that seat's link onto a departure that is already back, and
 * a shop paying $25 a friend. Each test then breaks one thing.
 */
async function referral(options: { endsAgoMs?: number } = {}) {
  const base = await tripCreditTestFixture(ctx.db);
  const { db, shop, diver, booking } = base;
  await db.update(shops).set({ buddyCreditCents: 2_500 }).where(eq(shops.id, shop.id));
  const friend = await createPerson(db, {
    shopId: shop.id,
    fullName: "Brought Friend",
    email: `${randomUUID()}@example.com`,
    phone: null,
    origin: "counter",
  });
  const endsAt = new Date(nowDate().getTime() - (options.endsAgoMs ?? DAY));
  const [past] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Yesterday's reef",
      startsAt: new Date(endsAt.getTime() - 3 * 3_600_000),
      endsAt,
      capacity: 8,
      priceCents: 10_000,
    })
    .returning();
  const seat = await bookFriend(base.shop.id, past.id, friend.id, booking.id);
  return { ...base, friend, past, seat, referrerId: diver.id };
}

async function bookFriend(shopId: string, tripId: string, personId: string, viaBookingId: string) {
  const [seat] = await ctx.db
    .insert(bookings)
    .values({ shopId, tripId, personId, bookedAs: "diver" })
    .returning();
  await ctx.db
    .insert(bookingReferrals)
    .values({ shopId, bookingId: seat.id, referredByBookingId: viaBookingId });
  return seat;
}

async function referralEntries(shopId: string) {
  return (
    await ctx.db.select().from(tripCreditEntries).where(eq(tripCreditEntries.shopId, shopId))
  ).filter((entry) => entry.reason === "referral");
}

describe("buddy credit", () => {
  it("bounds each hourly sweep to 200 referrals", () => {
    expect(BUDDY_CREDIT_SWEEP_LIMIT).toBe(200);
  });

  it("credits the referrer once, however often the referral is read", async () => {
    const { db, shop, seat, referrerId } = await referral();
    expect(await grantBuddyCredits(db, { now: nowDate() })).toMatchObject({ granted: 1 });
    expect(await grantBuddyCredits(db, { now: nowDate() })).toMatchObject({ granted: 0 });
    const entries = await referralEntries(shop.id);
    expect(entries).toEqual([
      expect.objectContaining({
        id: buddyCreditEntryId(seat.id),
        personId: referrerId,
        kind: "grant",
        reason: "referral",
        bookingId: seat.id,
        actorPersonId: null,
        currency: "usd",
        amountCents: 2_500,
      }),
    ]);
    expect((await readTripCredit(db, shop.id, referrerId, "usd")).balanceCents).toBe(2_500);
  });

  it("credits even the smallest enabled amount and reports the whole sweep", async () => {
    const { db, shop, referrerId } = await referral();
    await db.update(shops).set({ buddyCreditCents: 1 }).where(eq(shops.id, shop.id));
    expect(await grantBuddyCredits(db, { now: nowDate() })).toEqual({
      granted: 1,
      busy: 0,
      skipped: 0,
    });
    expect((await readTripCredit(db, shop.id, referrerId, "usd")).balanceCents).toBe(1);
  });

  it("rechecks each candidate against its own booking when multiple shops have referrals", async () => {
    const first = await referral();
    const second = await referral();
    expect(await grantBuddyCredits(first.db, { now: nowDate() })).toEqual({
      granted: 2,
      busy: 0,
      skipped: 0,
    });
    expect(await referralEntries(first.shop.id)).toHaveLength(1);
    expect(await referralEntries(second.shop.id)).toHaveLength(1);
  });

  it("skips a referral when the shop currency cannot be written to the ledger", async () => {
    const { db, shop } = await referral();
    await db.update(shops).set({ currency: "USD" }).where(eq(shops.id, shop.id));
    expect(await grantBuddyCredits(db, { now: nowDate() })).toEqual({
      granted: 0,
      busy: 0,
      skipped: 1,
    });
    expect(await referralEntries(shop.id)).toHaveLength(0);
  });

  it("rechecks a credit amount changed after the candidate read", async () => {
    const { db, shop } = await referral();
    const interleaved = beforeGrantTransaction(db, () =>
      db.update(shops).set({ buddyCreditCents: 0 }).where(eq(shops.id, shop.id)),
    );
    expect(await grantBuddyCredits(interleaved, { now: nowDate() })).toEqual({
      granted: 0,
      busy: 0,
      skipped: 1,
    });
    expect(await referralEntries(shop.id)).toHaveLength(0);
  });

  it("rechecks that the referrer is live after the candidate read", async () => {
    const { db, shop, referrerId } = await referral();
    const interleaved = beforeGrantTransaction(db, () =>
      db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, referrerId)),
    );
    expect(await grantBuddyCredits(interleaved, { now: nowDate() })).toEqual({
      granted: 0,
      busy: 0,
      skipped: 1,
    });
    expect(await referralEntries(shop.id)).toHaveLength(0);
  });

  it("skips a referral when the existing ledger balance is negative", async () => {
    const { db, shop, booking, actor, referrerId } = await referral();
    await db.insert(tripCreditEntries).values({
      id: randomUUID(),
      shopId: shop.id,
      personId: referrerId,
      actorPersonId: actor.id,
      currency: "usd",
      kind: "redeem",
      amountCents: 1,
      bookingId: booking.id,
    });
    expect(await grantBuddyCredits(db, { now: nowDate() })).toEqual({
      granted: 0,
      busy: 0,
      skipped: 1,
    });
    expect(await referralEntries(shop.id)).toHaveLength(0);
  });

  it("reports an entry ID conflict as skipped rather than granted", async () => {
    const { db, shop, seat, actor, referrerId } = await referral();
    await db.insert(tripCreditEntries).values({
      id: buddyCreditEntryId(seat.id),
      shopId: shop.id,
      personId: referrerId,
      actorPersonId: actor.id,
      currency: "usd",
      kind: "grant",
      amountCents: 1,
      reason: "goodwill",
    });
    expect(await grantBuddyCredits(db, { now: nowDate() })).toEqual({
      granted: 0,
      busy: 0,
      skipped: 1,
    });
    expect(await referralEntries(shop.id)).toHaveLength(0);
  });

  it.each([
    ["55P03", true],
    ["23514", false],
  ] as const)("handles database error %s during a grant", async (code, busy) => {
    const { db, shop } = await referral();
    // Exercise the real transaction and error wrapping, with a database trigger
    // standing in for a lock refusal or an unrelated constraint failure.
    await db.execute(
      sql.raw(`CREATE OR REPLACE FUNCTION test_buddy_credit_failure() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'injected grant failure' USING ERRCODE = '${code}'; END;
    $$ LANGUAGE plpgsql`),
    );
    await db.execute(
      sql.raw(`CREATE TRIGGER test_buddy_credit_failure BEFORE INSERT ON trip_credit_entries
      FOR EACH ROW EXECUTE FUNCTION test_buddy_credit_failure()`),
    );
    if (busy) {
      expect(await grantBuddyCredits(db, { now: nowDate() })).toEqual({
        granted: 0,
        busy: 1,
        skipped: 0,
      });
    } else {
      await expect(grantBuddyCredits(db, { now: nowDate() })).rejects.toThrow();
    }
    expect(await referralEntries(shop.id)).toHaveLength(0);
  });

  it("bounds lock waits inside the credit transaction", async () => {
    const { db, shop } = await referral();
    await db.execute(
      sql.raw(`CREATE OR REPLACE FUNCTION test_buddy_credit_lock_timeout() RETURNS trigger AS $$
      BEGIN
        IF current_setting('lock_timeout') <> '5s' THEN
          RAISE EXCEPTION 'buddy credit lock timeout is not bounded';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`),
    );
    await db.execute(
      sql.raw(`CREATE TRIGGER test_buddy_credit_lock_timeout BEFORE INSERT ON trip_credit_entries
      FOR EACH ROW EXECUTE FUNCTION test_buddy_credit_lock_timeout()`),
    );
    expect(await grantBuddyCredits(db, { now: nowDate() })).toEqual({
      granted: 1,
      busy: 0,
      skipped: 0,
    });
    expect(await referralEntries(shop.id)).toHaveLength(1);
  });

  it("credits a friend once, not each seat they book on the same link", async () => {
    const { db, shop, booking, friend, past, referrerId } = await referral();
    const [again] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Another past reef",
        startsAt: new Date(past.startsAt.getTime() - DAY),
        endsAt: new Date(past.endsAt.getTime() - DAY),
        capacity: 8,
        priceCents: 10_000,
      })
      .returning();
    await bookFriend(shop.id, again.id, friend.id, booking.id);
    const second = await createPerson(db, {
      shopId: shop.id,
      fullName: "Second Friend",
      email: `${randomUUID()}@example.com`,
      phone: null,
      origin: "counter",
    });
    await bookFriend(shop.id, past.id, second.id, booking.id);
    expect(await grantBuddyCredits(db, { now: nowDate() })).toEqual({
      granted: 2,
      busy: 0,
      skipped: 1,
    });
    await grantBuddyCredits(db, { now: nowDate() });
    expect(await referralEntries(shop.id)).toHaveLength(2);
    expect((await readTripCredit(db, shop.id, referrerId, "usd")).balanceCents).toBe(5_000);
  });

  it.each([
    ["a cancelled booking", "cancelled"],
    ["a no-show", "no_show"],
  ] as const)("earns nothing for %s", async (_name, status) => {
    const { db, shop, seat } = await referral();
    await db.update(bookings).set({ status }).where(eq(bookings.id, seat.id));
    await grantBuddyCredits(db, { now: nowDate() });
    expect(await referralEntries(shop.id)).toHaveLength(0);
  });

  it("earns nothing for a cancelled departure or a rehearsal", async () => {
    const { db, shop, past } = await referral();
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, past.id));
    await grantBuddyCredits(db, { now: nowDate() });
    await db
      .update(trips)
      .set({ status: "scheduled", isRehearsal: true, isPrivate: true })
      .where(eq(trips.id, past.id));
    await grantBuddyCredits(db, { now: nowDate() });
    expect(await referralEntries(shop.id)).toHaveLength(0);
  });

  it("waits until the friend's boat is an hour past its return", async () => {
    const { db, shop } = await referral({ endsAgoMs: 30 * 60_000 });
    await grantBuddyCredits(db, { now: nowDate() });
    expect(await referralEntries(shop.id)).toHaveLength(0);
    await grantBuddyCredits(db, { now: new Date(nowDate().getTime() + 31 * 60_000) });
    expect(await referralEntries(shop.id)).toHaveLength(1);
  });

  it("earns nothing when the departure roll call says the friend stayed ashore", async () => {
    const { db, shop, actor, past, seat } = await referral();
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: past.id,
      subjectKind: "seat",
      bookingId: seat.id,
      recordedByPersonId: actor.id,
      status: "not_boarded",
      statementStatus: "not_boarded",
      checkpoint: "departure",
      causalFrontier: [],
      occurredAt: nowDate(),
    });
    await grantBuddyCredits(db, { now: nowDate() });
    expect(await referralEntries(shop.id)).toHaveLength(0);
  });

  it("earns nothing while the shop's buddy credit is zero or buddy links are off", async () => {
    const { db, shop } = await referral();
    await db.update(shops).set({ buddyCreditCents: 0 }).where(eq(shops.id, shop.id));
    await grantBuddyCredits(db, { now: nowDate() });
    await db
      .update(shops)
      .set({ buddyCreditCents: 2_500, buddyLinksEnabled: false })
      .where(eq(shops.id, shop.id));
    await grantBuddyCredits(db, { now: nowDate() });
    expect(await referralEntries(shop.id)).toHaveLength(0);
  });

  it("earns nothing for an erased referrer", async () => {
    const { db, shop, referrerId } = await referral();
    await db
      .update(people)
      .set({ anonymizedAt: nowDate(), deletedAt: nowDate() })
      .where(eq(people.id, referrerId));
    await grantBuddyCredits(db, { now: nowDate() });
    expect(await referralEntries(shop.id)).toHaveLength(0);
  });

  it("earns nothing when the friend is the referrer under another seat", async () => {
    const { db, shop, seat, referrerId } = await referral();
    await db.update(bookings).set({ personId: referrerId }).where(eq(bookings.id, seat.id));
    await grantBuddyCredits(db, { now: nowDate() });
    expect(await referralEntries(shop.id)).toHaveLength(0);
  });

  it("keeps referral credit system-written: staff cannot pick it, and the ledger refuses an actor", async () => {
    const { db, shop, seat, grant, actor, referrerId } = await referral();
    expect(
      await grantTripCredit(db, { ...grant, reason: "referral" as unknown as "goodwill" }),
    ).toEqual({ ok: false, reason: "invalid" });
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(tripCreditEntries).values({
          id: randomUUID(),
          shopId: shop.id,
          personId: referrerId,
          actorPersonId: actor.id,
          currency: "usd",
          kind: "grant",
          amountCents: 2_500,
          reason: "referral",
          bookingId: seat.id,
        });
      }),
    ).rejects.toThrow();
  });
});
