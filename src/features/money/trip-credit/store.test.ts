import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { cancelBooking, createBooking } from "@/db/bookings";
import { getBookingPayment, setBookingPayment } from "@/db/payments";
import { createPerson } from "@/db/people";
import {
  queueBookingRefundOnShopCancellation,
  refundBookingOnCancellation,
  refundBookingOnShopCancellation,
  shopCancellationPaymentStory,
} from "@/db/refunds";
import {
  bookingPaymentEvents,
  bookings,
  collectionEntries,
  people,
  shops,
  tripCreditEntries,
  trips,
  userAccounts,
} from "@/db/schema";
import { setTripStatus } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { tripCreditTestFixture } from "@/test/trip-credit-fixture";
import { grantTripCredit, readTripCredit, redeemTripCredit } from "./store";

const ctx = fileScopedShopContext();

function fixture() {
  return tripCreditTestFixture(ctx.db, ctx.shop);
}

describe("promotional trip credit lifecycle", () => {
  it.each([
    ["diver cancellation", refundBookingOnCancellation],
    ["immediate shop cancellation", refundBookingOnShopCancellation],
    ["queued shop cancellation", queueBookingRefundOnShopCancellation],
  ] as const)(
    "restores a called-off departure's promotional fare once through %s",
    async (_name, refund) => {
      const { db, shop, trip, booking, diver, grant, redeem } = await fixture();
      expect((await grantTripCredit(db, grant)).ok).toBe(true);
      expect((await redeemTripCredit(db, redeem)).ok).toBe(true);
      // Phase one calls off the departure while retaining its bookings. A resumed
      // cancellation must return promotional value even before a seat is removed.
      await setTripStatus(db, shop.id, trip.id, "cancelled");
      const input = { shopId: shop.id, bookingId: booking.id };
      expect(await refund(db, input)).toEqual({ status: "credit_returned" });
      expect(await refund(db, input)).toEqual({ status: "credit_returned" });
      expect(shopCancellationPaymentStory({ status: "credit_returned" })).toBe("credit_returned");
      expect(await getBookingPayment(db, shop.id, booking.id)).toMatchObject({
        status: "unpaid",
        provider: "trip_credit_returned",
        amountCents: null,
      });
      const ledger = await readTripCredit(db, shop.id, diver.id, "usd");
      expect(ledger.balanceCents).toBe(10_000);
      expect(ledger.entries.filter((entry) => entry.kind === "restore")).toHaveLength(1);
      expect(
        await db.select().from(collectionEntries).where(eq(collectionEntries.sourceId, booking.id)),
      ).toHaveLength(0);
      expect(await db.select().from(bookings).where(eq(bookings.id, booking.id))).toMatchObject([
        { status: "booked" },
      ]);
    },
  );

  it("does not let an old promotional return replace the later cash-refund story", async () => {
    const { db, shop, booking, trip, diver, grant, redeem } = await fixture();
    expect((await grantTripCredit(db, grant)).ok).toBe(true);
    expect((await redeemTripCredit(db, redeem)).ok).toBe(true);
    expect((await cancelBooking(db, shop.id, booking.id)).ok).toBe(true);
    expect(
      await refundBookingOnShopCancellation(db, { shopId: shop.id, bookingId: booking.id }),
    ).toMatchObject({ status: "credit_returned" });
    const again = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      personId: diver.id,
    });
    expect(again.ok).toBe(true);
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: booking.id,
      status: "paid",
      amountCents: 10_000,
      currency: "usd",
      method: "cash",
    });
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: booking.id,
      status: "refunded",
      amountCents: 0,
      currency: "usd",
    });
    expect((await cancelBooking(db, shop.id, booking.id)).ok).toBe(true);
    expect(
      await refundBookingOnShopCancellation(db, { shopId: shop.id, bookingId: booking.id }),
    ).toMatchObject({ status: "already_refunded" });
  });
  it("does not report an earlier life's restored credit on an unpaid reactivation", async () => {
    const { db, shop, booking, trip, diver, grant, redeem } = await fixture();
    await grantTripCredit(db, grant);
    await redeemTripCredit(db, redeem);
    await cancelBooking(db, shop.id, booking.id);
    expect(
      (
        await createBooking(db, {
          actor: "staff",
          shopId: shop.id,
          tripId: trip.id,
          personId: diver.id,
        })
      ).ok,
    ).toBe(true);
    await cancelBooking(db, shop.id, booking.id);
    expect(
      await refundBookingOnShopCancellation(db, { shopId: shop.id, bookingId: booking.id }),
    ).toMatchObject({ status: "unpaid" });
  });
});

it("grants and spends once, preserves payload equality, and records zero cash collections", async () => {
  const { db, shop, diver, grant, redeem } = await fixture();
  expect(await grantTripCredit(db, grant)).toMatchObject({
    ok: true,
    balanceCents: 10_000,
    replay: false,
  });
  expect(await grantTripCredit(db, grant)).toMatchObject({
    ok: true,
    balanceCents: 10_000,
    replay: true,
  });
  expect(await grantTripCredit(db, { ...grant, reason: "promotion" })).toMatchObject({
    ok: false,
    reason: "changed",
  });
  expect(await redeemTripCredit(db, redeem)).toMatchObject({
    ok: true,
    balanceCents: 0,
    amountCents: 10_000,
  });
  expect(await redeemTripCredit(db, redeem)).toMatchObject({
    ok: true,
    balanceCents: 0,
    replay: true,
  });
  expect(await redeemTripCredit(db, { ...redeem, attemptId: randomUUID() })).toMatchObject({
    ok: false,
    reason: "unavailable",
  });
  expect(await getBookingPayment(db, shop.id, redeem.bookingId)).toMatchObject({
    status: "paid",
    provider: "trip_credit",
    amountCents: 0,
    manualHeldCents: 0,
  });
  expect(
    await db
      .select()
      .from(collectionEntries)
      .where(
        and(
          eq(collectionEntries.shopId, shop.id),
          eq(collectionEntries.sourceId, redeem.bookingId),
        ),
      ),
  ).toHaveLength(0);
  expect((await readTripCredit(db, shop.id, diver.id, "usd")).entries).toHaveLength(2);
});

it("returns only the spent promotional amount once and never re-spends on a cancelled replay", async () => {
  const { db, shop, diver, booking, grant, redeem } = await fixture();
  await grantTripCredit(db, grant);
  await redeemTripCredit(db, redeem);
  await cancelBooking(db, shop.id, booking.id);
  expect(
    await refundBookingOnShopCancellation(db, { shopId: shop.id, bookingId: booking.id }),
  ).toMatchObject({ status: "credit_returned" });
  expect(
    await refundBookingOnShopCancellation(db, { shopId: shop.id, bookingId: booking.id }),
  ).toMatchObject({ status: "credit_returned" });
  expect(await redeemTripCredit(db, redeem)).toMatchObject({
    ok: true,
    replay: true,
    balanceCents: 10_000,
  });
  expect(await getBookingPayment(db, shop.id, booking.id)).toMatchObject({
    status: "unpaid",
    provider: "trip_credit_returned",
  });
  expect((await readTripCredit(db, shop.id, diver.id, "usd")).balanceCents).toBe(10_000);
  expect(
    await db
      .select()
      .from(tripCreditEntries)
      .where(
        and(eq(tripCreditEntries.bookingId, booking.id), eq(tripCreditEntries.kind, "restore")),
      ),
  ).toHaveLength(1);
  expect(
    await db.select().from(collectionEntries).where(eq(collectionEntries.sourceId, booking.id)),
  ).toHaveLength(0);
});

it("refuses stale fare, insufficient balance, unsupported tax, and unconfirmed identity without a debit", async () => {
  const { db, shop, booking, grant, redeem } = await fixture();
  expect(await redeemTripCredit(db, redeem)).toMatchObject({ ok: false, reason: "insufficient" });
  await grantTripCredit(db, grant);
  expect(await redeemTripCredit(db, { ...redeem, expectedFareCents: 9_000 })).toMatchObject({
    ok: false,
    reason: "changed",
  });
  await db.update(shops).set({ taxEnabled: true }).where(eq(shops.id, shop.id));
  expect(await redeemTripCredit(db, redeem)).toMatchObject({ ok: false, reason: "unavailable" });
  await db.update(shops).set({ taxEnabled: false }).where(eq(shops.id, shop.id));
  await db
    .update(bookings)
    .set({ identityUnconfirmedAt: nowDate() })
    .where(eq(bookings.id, booking.id));
  expect(await redeemTripCredit(db, redeem)).toMatchObject({ ok: false, reason: "unavailable" });
  expect(
    await db.select().from(tripCreditEntries).where(eq(tripCreditEntries.kind, "redeem")),
  ).toHaveLength(0);
});

it("refuses erased beneficiaries, disabled staff, currency changes, and foreign tenant identities", async () => {
  const { db, shop, diver, actor, grant, redeem } = await fixture();
  await grantTripCredit(db, grant);
  expect(
    await grantTripCredit(db, { ...grant, attemptId: randomUUID(), currency: "eur" }),
  ).toMatchObject({ ok: false, reason: "changed" });
  await db
    .update(userAccounts)
    .set({ status: "disabled" })
    .where(eq(userAccounts.personId, actor.id));
  expect(await redeemTripCredit(db, redeem)).toMatchObject({ ok: false, reason: "not_authorized" });
  await db
    .update(userAccounts)
    .set({ status: "active" })
    .where(eq(userAccounts.personId, actor.id));
  await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, diver.id));
  expect(await redeemTripCredit(db, redeem)).toMatchObject({ ok: false, reason: "not_found" });
  const [other] = await db
    .insert(shops)
    .values({ name: "Other", slug: randomUUID(), timezone: "UTC" })
    .returning();
  expect(
    await grantTripCredit(db, { ...grant, attemptId: randomUUID(), shopId: other.id }),
  ).toMatchObject({ ok: false, reason: "not_found" });
  expect((await readTripCredit(db, shop.id, diver.id, "usd")).balanceCents).toBe(10_000);
});

it("rejects source payments even after they were reset to unpaid", async () => {
  const { db, shop, grant, redeem } = await fixture();
  await grantTripCredit(db, grant);
  await setBookingPayment(db, {
    shopId: shop.id,
    bookingId: redeem.bookingId,
    status: "paid",
    amountCents: 10_000,
    currency: "usd",
    provider: "stripe",
    providerRef: "cs_past_receipt",
  });
  await setBookingPayment(db, {
    shopId: shop.id,
    bookingId: redeem.bookingId,
    status: "unpaid",
    amountCents: null,
    currency: "usd",
  });
  const before = await db
    .select()
    .from(bookingPaymentEvents)
    .where(eq(bookingPaymentEvents.bookingId, redeem.bookingId));
  expect(await redeemTripCredit(db, redeem)).toMatchObject({ ok: false, reason: "unavailable" });
  expect(
    await db
      .select()
      .from(bookingPaymentEvents)
      .where(eq(bookingPaymentEvents.bookingId, redeem.bookingId)),
  ).toEqual(before);
});

it("rejects malformed journal grant rows at the database boundary", async () => {
  const { db, grant } = await fixture();
  const values = {
    id: randomUUID(),
    shopId: grant.shopId,
    personId: grant.personId,
    actorPersonId: grant.actorPersonId,
    currency: "usd",
    kind: "grant" as const,
    amountCents: 1,
    reason: null,
  };
  await expect(
    db.transaction((tx) => tx.insert(tripCreditEntries).values(values)),
  ).rejects.toThrow();
  await expect(
    db.transaction((tx) =>
      tx.insert(tripCreditEntries).values({ ...values, reason: "goodwill", amountCents: -1 }),
    ),
  ).rejects.toThrow();
});

it("preserves credit fare coverage when a diver stops diving after departure", async () => {
  const { db, shop, actor, trip, booking, diver, grant, redeem } = await fixture();
  const { setBookingParticipantType } = await import("@/db/bookings");
  await grantTripCredit(db, grant);
  await redeemTripCredit(db, redeem);
  await db
    .update(trips)
    .set({
      startsAt: new Date(nowDate().getTime() - 60_000),
      endsAt: new Date(nowDate().getTime() + 3_600_000),
      riderPriceCents: 5_000,
    })
    .where(eq(trips.id, trip.id));
  expect(
    await setBookingParticipantType(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.id,
      actorPersonId: actor.id,
      to: "rider",
    }),
  ).toMatchObject({ ok: true });
  expect(await getBookingPayment(db, shop.id, booking.id)).toMatchObject({
    status: "paid",
    provider: "trip_credit",
    amountCents: 0,
  });
  expect((await readTripCredit(db, shop.id, diver.id, "usd")).balanceCents).toBe(0);
});

it("refuses a higher fare correction and a credit-covered move without changing source evidence", async () => {
  const { db, shop, actor, trip, booking, grant, redeem } = await fixture();
  const { moveBooking, setBookingParticipantType } = await import("@/db/bookings");
  await grantTripCredit(db, grant);
  await redeemTripCredit(db, redeem);
  await db.update(trips).set({ snorkelerPriceCents: 15_000 }).where(eq(trips.id, trip.id));
  const before = await getBookingPayment(db, shop.id, booking.id);
  expect(
    await setBookingParticipantType(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.id,
      actorPersonId: actor.id,
      to: "snorkeler",
    }),
  ).toMatchObject({ ok: false, reason: "participant_type_unavailable" });
  const [other] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Other boat",
      startsAt: new Date(trip.startsAt.getTime() + 86_400_000),
      endsAt: new Date(trip.endsAt.getTime() + 86_400_000),
      capacity: 4,
      priceCents: 10_000,
    })
    .returning();
  expect(
    await moveBooking(db, {
      shopId: shop.id,
      fromTripId: trip.id,
      toTripId: other.id,
      bookingId: booking.id,
    }),
  ).toMatchObject({ ok: false, reason: "not_movable" });
  expect(await getBookingPayment(db, shop.id, booking.id)).toEqual(before);
  const [after] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
  expect(after).toMatchObject({ tripId: trip.id, participantType: "diver" });
});

it("keeps original-currency balances visible after a currency change", async () => {
  const { db, shop, diver, grant } = await fixture();
  await grantTripCredit(db, grant);
  await db.update(shops).set({ currency: "eur" }).where(eq(shops.id, shop.id));
  await grantTripCredit(db, {
    ...grant,
    attemptId: randomUUID(),
    currency: "eur",
    amountCents: 5_000,
  });
  expect((await readTripCredit(db, shop.id, diver.id, "eur")).balances).toEqual(
    expect.arrayContaining([
      { currency: "usd", balanceCents: 10_000 },
      { currency: "eur", balanceCents: 5_000 },
    ]),
  );
});

it("refuses another checkout and preserves coverage when a late provider receipt is held for reconciliation", async () => {
  const { db, shop, trip, booking, grant, redeem } = await fixture();
  const { startBookingCheckout } = await import("@/db/checkouts");
  const { setBookingPaymentIfNotFinal } = await import("@/db/payments");
  const { upsertShopStripeAccount, setShopStripeAccountStatus } = await import(
    "@/db/stripe-accounts"
  );
  const { recordingCheckout } = await import("@/test/fakes");
  await grantTripCredit(db, grant);
  await redeemTripCredit(db, redeem);
  await upsertShopStripeAccount(db, shop.id, "acct_credit_test");
  await setShopStripeAccountStatus(db, "acct_credit_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const seen = recordingCheckout();
  expect(
    await startBookingCheckout(
      db,
      {
        shopId: shop.id,
        tripId: trip.id,
        bookingIds: [booking.id],
        customerEmail: "credit@example.com",
        successUrl: "https://diveday.example/paid",
        cancelUrl: "https://diveday.example/cancel",
        describeLine: ({ tripTitle }) => tripTitle,
      },
      seen.provider,
    ),
  ).toEqual({ ok: false, reason: "already_paid" });
  expect(seen.requests).toEqual([]);
  await db.transaction((tx) =>
    setBookingPaymentIfNotFinal(tx, {
      shopId: shop.id,
      bookingId: booking.id,
      status: "paid",
      amountCents: 10_000,
      currency: "usd",
      provider: "stripe",
      providerRef: "cs_late_receipt",
      operation: "checkout_settled",
    }),
  );
  expect(await getBookingPayment(db, shop.id, booking.id)).toMatchObject({
    status: "paid",
    provider: "trip_credit",
    amountCents: 0,
  });
  expect(
    await db.select().from(collectionEntries).where(eq(collectionEntries.sourceId, booking.id)),
  ).toHaveLength(0);
});

it("merges balances as an audited identity correction without changing economic journal amounts", async () => {
  const { db, shop, actor, diver, grant, redeem } = await fixture();
  const { mergeDiverRecords } = await import("@/db/diver-merge");
  const survivor = await createPerson(db, {
    shopId: shop.id,
    fullName: diver.fullName,
    email: null,
    phone: null,
    origin: "counter",
  });
  await grantTripCredit(db, grant);
  await grantTripCredit(db, {
    ...grant,
    personId: survivor.id,
    attemptId: randomUUID(),
    amountCents: 5_000,
  });
  const before = await db
    .select({
      id: tripCreditEntries.id,
      kind: tripCreditEntries.kind,
      cents: tripCreditEntries.amountCents,
      currency: tripCreditEntries.currency,
      occurredAt: tripCreditEntries.occurredAt,
    })
    .from(tripCreditEntries)
    .where(eq(tripCreditEntries.shopId, shop.id))
    .orderBy(asc(tripCreditEntries.id));
  expect(
    await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: diver.id,
      survivorId: survivor.id,
      actorPersonId: actor.id,
    }),
  ).toMatchObject({ ok: true });
  expect((await readTripCredit(db, shop.id, survivor.id, "usd")).balanceCents).toBe(15_000);
  expect(
    await db
      .select({
        id: tripCreditEntries.id,
        kind: tripCreditEntries.kind,
        cents: tripCreditEntries.amountCents,
        currency: tripCreditEntries.currency,
        occurredAt: tripCreditEntries.occurredAt,
      })
      .from(tripCreditEntries)
      .where(eq(tripCreditEntries.shopId, shop.id))
      .orderBy(asc(tripCreditEntries.id)),
  ).toEqual(before);
  expect(await redeemTripCredit(db, redeem)).toMatchObject({ ok: false, reason: "not_found" });
  expect(await redeemTripCredit(db, { ...redeem, personId: survivor.id })).toMatchObject({
    ok: true,
    balanceCents: 5_000,
  });
});

it("retains anonymous economic history on erasure and refuses later spending", async () => {
  const { db, shop, actor, diver, grant, redeem } = await fixture();
  const { anonymizeDiver } = await import("@/features/records/anonymize");
  await grantTripCredit(db, grant);
  expect(
    await anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: actor.id }),
  ).toMatchObject({ ok: true });
  const entries = await db
    .select()
    .from(tripCreditEntries)
    .where(eq(tripCreditEntries.personId, diver.id));
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ amountCents: 10_000, actorPersonId: actor.id });
  expect(await redeemTripCredit(db, redeem)).toMatchObject({ ok: false });
});
