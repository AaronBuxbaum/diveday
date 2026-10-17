import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { fakeCheckout } from "@/test/fakes";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { createBookingParty } from "./bookings";
import {
  markCheckoutPaidBySessionId,
  recordCheckoutPaymentIntent,
  startBookingCheckout,
} from "./checkouts";
import { listStuckPaymentOperations } from "./payment-operations";
import { getBookingPayment, setBookingPayment } from "./payments";
import { recordStripeChargeRefund } from "./refunds";
import { activityEvents, paymentOperationIntents } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { upcomingTripsWithCounts, updateTrip } from "./trips";
import { attributeUnattributedRefund, listUnattributedRefunds } from "./unattributed-refunds";

/**
 * A refund made in the Stripe dashboard on a party checkout names an amount,
 * never a seat. Aaron, 2026-10-13 (issue #2293): hold it as an unattributed
 * amount and raise it on the Orders index so staff pick the seat; never a
 * silent proportional split.
 */

const ctx = fileScopedShopContext();

const OTHER_SHOP = "99999999-8888-4777-8666-555555555555";

async function paidParty() {
  const { db, shop } = ctx;
  await upsertShopStripeAccount(db, shop.id, "acct_party");
  await setShopStripeAccountStatus(db, "acct_party", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  await updateTrip(db, shop.id, reef.id, {
    title: reef.title,
    startsAt: reef.startsAt,
    endsAt: reef.endsAt,
    capacity: reef.capacity,
    plannedDives: reef.plannedDives,
    priceCents: 10_000,
  });
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Lena Partyhead",
      email: "lena.party@example.com",
    },
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Mo Partyguest",
      email: "mo.party@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const [lead, guest] = party.bookings.map((booking) => booking.bookingId);
  if (!lead || !guest) throw new Error("no bookings");
  const start = await startBookingCheckout(
    db,
    {
      shopId: shop.id,
      tripId: reef.id,
      bookingIds: [lead, guest],
      customerEmail: "lena.party@example.com",
      successUrl: "https://diveday.example/return",
      cancelUrl: "https://diveday.example/cancel",
      describeLine: ({ tripTitle }) => tripTitle,
    },
    fakeCheckout(),
  );
  if (!start.ok) throw new Error("checkout start failed");
  await markCheckoutPaidBySessionId(db, start.checkout.stripeSessionId, "acct_party", 20_000);
  await recordCheckoutPaymentIntent(db, {
    stripeSessionId: start.checkout.stripeSessionId,
    paymentIntentId: "pi_party",
  });
  const actor = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  return { db, shop, reef, lead, guest, checkout: start.checkout, actor };
}

async function dashboardRefund(
  db: typeof ctx.db,
  amountRefundedCents: number,
  chargeId = "ch_party",
) {
  return recordStripeChargeRefund(db, {
    stripeAccountId: "acct_party",
    paymentIntentId: "pi_party",
    amountRefundedCents,
    chargeId,
    occurredAt: nowDate(),
  });
}

describe("a dashboard refund on a party checkout", () => {
  it("is held as an unattributed amount with the party's seats to choose from", async () => {
    const { db, shop, reef, lead, guest } = await paidParty();

    expect(await dashboardRefund(db, 6_000)).toEqual({ status: "checkout_unattributed" });

    const queue = await listUnattributedRefunds(db, shop.id);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      amountCents: 6_000,
      chargeId: "ch_party",
      tripId: reef.id,
      tripTitle: reef.title,
    });
    expect(queue[0]?.seats.map((seat) => [seat.bookingId, seat.diverName, seat.heldCents])).toEqual(
      expect.arrayContaining([
        [lead, "Lena Partyhead", 10_000],
        [guest, "Mo Partyguest", 10_000],
      ]),
    );
    // Nothing was guessed onto a seat.
    expect((await getBookingPayment(db, shop.id, lead))?.status).toBe("paid");
    expect((await getBookingPayment(db, shop.id, guest))?.status).toBe("paid");
  });

  it("is listed once however often Stripe redelivers the event", async () => {
    const { db, shop } = await paidParty();
    await dashboardRefund(db, 6_000);
    expect(await dashboardRefund(db, 6_000)).toEqual({ status: "already_recorded" });
    expect(await listUnattributedRefunds(db, shop.id)).toHaveLength(1);
  });

  it("is not also listed among the payments that need a check on the Orders index", async () => {
    const { db, shop } = await paidParty();
    await dashboardRefund(db, 6_000);
    // `started_at` is the database's clock, which the frozen test clock does not move.
    const later = new Date("2100-01-01T00:00:00Z");
    const all = await listStuckPaymentOperations(db, shop.id, later);
    const shown = await listStuckPaymentOperations(db, shop.id, later, {
      withoutUnattributedRefunds: true,
    });
    expect(all.some((op) => op.intent.amountCents === 6_000)).toBe(true);
    expect(shown.some((op) => op.intent.amountCents === 6_000)).toBe(false);
  });
});

describe("attributeUnattributedRefund", () => {
  it("writes the refund onto the seat staff picked and clears the queue", async () => {
    const { db, shop, lead, guest, actor } = await paidParty();
    await dashboardRefund(db, 6_000);
    const [held] = await listUnattributedRefunds(db, shop.id);
    if (!held) throw new Error("expected a held refund");

    const outcome = await attributeUnattributedRefund(db, {
      shopId: shop.id,
      intentId: held.intentId,
      bookingId: guest,
      actorPersonId: actor,
    });

    expect(outcome).toEqual({ status: "attributed", remainingCents: 0 });
    expect(await getBookingPayment(db, shop.id, guest)).toMatchObject({
      status: "partly_refunded",
      amountCents: 4_000,
    });
    expect((await getBookingPayment(db, shop.id, lead))?.status).toBe("paid");
    expect(await listUnattributedRefunds(db, shop.id)).toEqual([]);
    const [intent] = await db
      .select()
      .from(paymentOperationIntents)
      .where(eq(paymentOperationIntents.id, held.intentId));
    expect(intent).toMatchObject({ status: "succeeded", amountCents: 0 });
    expect(intent?.resolvedAt).not.toBeNull();
    const [line] = await db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.bookingId, guest),
          eq(activityEvents.code, "dashboard_refund_matched"),
        ),
      );
    expect(line).toMatchObject({ actorPersonId: actor, params: { diver: "Mo Partyguest" } });
  });

  it("takes only what a seat holds and leaves the rest for the next seat", async () => {
    const { db, shop, lead, guest, actor } = await paidParty();
    await dashboardRefund(db, 15_000);
    const [held] = await listUnattributedRefunds(db, shop.id);
    if (!held) throw new Error("expected a held refund");

    expect(
      await attributeUnattributedRefund(db, {
        shopId: shop.id,
        intentId: held.intentId,
        bookingId: lead,
        actorPersonId: actor,
      }),
    ).toEqual({ status: "attributed", remainingCents: 5_000 });
    expect(await getBookingPayment(db, shop.id, lead)).toMatchObject({ status: "refunded" });
    const [rest] = await listUnattributedRefunds(db, shop.id);
    expect(rest).toMatchObject({ intentId: held.intentId, amountCents: 5_000 });
    // A fully refunded seat is no longer a choice.
    expect(rest?.seats.map((seat) => seat.bookingId)).toEqual([guest]);

    expect(
      await attributeUnattributedRefund(db, {
        shopId: shop.id,
        intentId: held.intentId,
        bookingId: guest,
        actorPersonId: actor,
      }),
    ).toEqual({ status: "attributed", remainingCents: 0 });
    expect(await getBookingPayment(db, shop.id, guest)).toMatchObject({
      status: "partly_refunded",
      amountCents: 5_000,
    });
    expect(await listUnattributedRefunds(db, shop.id)).toEqual([]);
  });

  it("refuses a second match once the amount is spent, so no seat is refunded twice", async () => {
    const { db, shop, lead, guest, actor } = await paidParty();
    await dashboardRefund(db, 6_000);
    const [held] = await listUnattributedRefunds(db, shop.id);
    if (!held) throw new Error("expected a held refund");
    const input = { shopId: shop.id, intentId: held.intentId, actorPersonId: actor };
    await attributeUnattributedRefund(db, { ...input, bookingId: guest });

    expect(await attributeUnattributedRefund(db, { ...input, bookingId: lead })).toEqual({
      status: "not_found",
    });
    expect(await attributeUnattributedRefund(db, { ...input, bookingId: guest })).toEqual({
      status: "not_found",
    });
    expect((await getBookingPayment(db, shop.id, lead))?.status).toBe("paid");
    expect((await getBookingPayment(db, shop.id, guest))?.amountCents).toBe(4_000);
  });

  it("refuses a seat that was not paid through that checkout", async () => {
    const { db, shop, reef, actor } = await paidParty();
    await dashboardRefund(db, 6_000);
    const [held] = await listUnattributedRefunds(db, shop.id);
    if (!held) throw new Error("expected a held refund");
    const stranger = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Sol Stranger",
        email: "sol.stranger@example.com",
      },
    ]);
    if (!stranger.ok) throw new Error("booking failed");
    const strangerSeat = stranger.bookings[0]?.bookingId ?? "";

    expect(
      await attributeUnattributedRefund(db, {
        shopId: shop.id,
        intentId: held.intentId,
        bookingId: strangerSeat,
        actorPersonId: actor,
      }),
    ).toEqual({ status: "not_on_checkout" });
    expect(await listUnattributedRefunds(db, shop.id)).toMatchObject([{ amountCents: 6_000 }]);
  });

  it("never reaches across shops, and refuses ids that are not ids", async () => {
    const { db, shop, guest, actor } = await paidParty();
    await dashboardRefund(db, 6_000);
    const [held] = await listUnattributedRefunds(db, shop.id);
    if (!held) throw new Error("expected a held refund");

    expect(await listUnattributedRefunds(db, OTHER_SHOP)).toEqual([]);
    expect(
      await attributeUnattributedRefund(db, {
        shopId: OTHER_SHOP,
        intentId: held.intentId,
        bookingId: guest,
        actorPersonId: actor,
      }),
    ).toEqual({ status: "not_found" });
    expect(
      await attributeUnattributedRefund(db, {
        shopId: shop.id,
        intentId: "not-a-uuid",
        bookingId: guest,
        actorPersonId: actor,
      }),
    ).toEqual({ status: "not_found" });
    expect((await getBookingPayment(db, shop.id, guest))?.status).toBe("paid");
  });

  it("only matches a held dashboard refund, never another stuck operation", async () => {
    const { db, shop, guest, actor, checkout } = await paidParty();
    const [other] = await db
      .insert(paymentOperationIntents)
      .values({ shopId: shop.id, kind: "refund", checkoutId: checkout.id, amountCents: 1_000 })
      .returning({ id: paymentOperationIntents.id });
    if (!other) throw new Error("fixture insert failed");

    expect(
      await attributeUnattributedRefund(db, {
        shopId: shop.id,
        intentId: other.id,
        bookingId: guest,
        actorPersonId: actor,
      }),
    ).toEqual({ status: "not_found" });
  });

  it("is not held when no seat of the checkout still holds money from it", async () => {
    const { db, shop, lead, guest, checkout } = await paidParty();
    for (const bookingId of [lead, guest]) {
      await setBookingPayment(db, {
        shopId: shop.id,
        bookingId,
        status: "refunded",
        amountCents: 10_000,
        currency: "usd",
        provider: "stripe",
        providerRef: checkout.stripeSessionId,
        operation: "stripe_dashboard_refund",
      });
    }

    await dashboardRefund(db, 6_000);

    expect(await listUnattributedRefunds(db, shop.id)).toEqual([]);
    const parked = await db
      .select({ id: paymentOperationIntents.id })
      .from(paymentOperationIntents)
      .where(
        and(
          eq(paymentOperationIntents.shopId, shop.id),
          eq(paymentOperationIntents.checkoutId, checkout.id),
        ),
      );
    expect(parked).toEqual([]);
  });
});
