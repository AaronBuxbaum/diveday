// @vitest-environment node

import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import type { CheckoutProvider, CreateCheckoutSessionResult } from "@/lib/payments/checkout";
import { seededShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { markCheckoutPaidBySessionId, startBookingCheckout } from "./checkouts";
import { getBookingPayment, setBookingPayment } from "./payments";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { upcomingTripsWithCounts, updateTrip } from "./trips";
import {
  claimStripeWebhookEvent,
  hasNewerAccountUpdate,
  releaseStripeWebhookEventClaim,
} from "./webhook-events";

const REEF_PRICE_CENTS = 18_000;

function fakeCheckout(): CheckoutProvider {
  let counter = 0;
  return {
    async createCheckoutSession(request): Promise<CreateCheckoutSessionResult> {
      counter += 1;
      return {
        status: "created",
        stripeSessionId: `cs_${counter}`,
        stripeStatus: "open",
        paymentStatus: "unpaid",
        checkoutUrl: `https://checkout.stripe.com/c/pay/cs_${counter}`,
        amountTotalCents: request.lineItems.reduce(
          (sum, line) => sum + line.unitAmountCents * line.quantity,
          0,
        ),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
    },
    async retrieveCheckoutSession() {
      return { status: "failed" };
    },
    async refundCheckoutSession() {
      return { status: "refunded", refundId: "re_test" };
    },
  };
}

/** A connected, charges-enabled shop with a priced future trip and a paid checkout for one diver. */
async function paidCheckoutContext() {
  const { db, shop } = await seededShopContext();
  await upsertShopStripeAccount(db, shop.id, "acct_test");
  await setShopStripeAccountStatus(db, "acct_test", {
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
    priceCents: REEF_PRICE_CENTS,
  });
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Ledger Diver",
      email: "ledger-diver@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`party booking failed: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;

  const start = await startBookingCheckout(
    db,
    {
      shopId: shop.id,
      tripId: reef.id,
      bookingIds: [bookingId],
      customerEmail: "ledger-diver@example.com",
      successUrl: "https://diveday.example/success",
      cancelUrl: "https://diveday.example/cancel",
      describeLine: () => "CALLER_LABEL",
    },
    fakeCheckout(),
  );
  if (!start.ok) throw new Error("checkout start failed");

  return { db, shop, bookingId, stripeSessionId: start.checkout.stripeSessionId };
}

describe("claimStripeWebhookEvent", () => {
  it("claims a fresh event id and refuses every later replay", async () => {
    const { db } = await seededShopContext();
    const input = {
      id: "evt_dedup_1",
      type: "checkout.session.completed",
      account: "acct_test",
      occurredAt: nowDate(),
    };
    expect(await claimStripeWebhookEvent(db, input)).toBe(true);
    expect(await claimStripeWebhookEvent(db, input)).toBe(false);
    expect(await claimStripeWebhookEvent(db, input)).toBe(false);
  });

  it("claims two different event ids independently", async () => {
    const { db } = await seededShopContext();
    const occurredAt = nowDate();
    expect(
      await claimStripeWebhookEvent(db, {
        id: "evt_a",
        type: "invoice.paid",
        account: null,
        occurredAt,
      }),
    ).toBe(true);
    expect(
      await claimStripeWebhookEvent(db, {
        id: "evt_b",
        type: "invoice.paid",
        account: null,
        occurredAt,
      }),
    ).toBe(true);
  });

  // The ledger's whole point (security review finding, docs ADR
  // 20260719-stripe-connect-orders): a redelivered event must be dropped
  // before it ever reaches a handler again, even if a human has since made a
  // legitimate change that a re-run of the handler would silently undo.
  it("a claimed event's replay never reaches the handler again, so a manual refund survives it", async () => {
    const { db, shop, bookingId, stripeSessionId } = await paidCheckoutContext();
    const event = {
      id: "evt_replay_paid",
      type: "checkout.session.completed",
      account: "acct_test",
      occurredAt: nowDate(),
    };

    // First delivery: claimed, so the route would call the real handler.
    expect(await claimStripeWebhookEvent(db, event)).toBe(true);
    await markCheckoutPaidBySessionId(db, stripeSessionId, "acct_test");
    expect(await getBookingPayment(db, shop.id, bookingId)).toMatchObject({ status: "paid" });

    // A human refunds the booking by hand between deliveries.
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "refunded",
      amountCents: 0,
      currency: "usd",
      provider: "stripe",
      providerRef: "re_manual",
    });

    // The exact same event is redelivered (Stripe is at-least-once).
    const claimedAgain = await claimStripeWebhookEvent(db, event);
    expect(claimedAgain).toBe(false);
    // Because the ledger already refused the replay, the route never calls
    // markCheckoutPaidBySessionId a second time — mirroring exactly what
    // `POST /api/webhooks/stripe` does with the same `claimed` result.
    if (claimedAgain) await markCheckoutPaidBySessionId(db, stripeSessionId, "acct_test");

    expect(await getBookingPayment(db, shop.id, bookingId)).toMatchObject({
      status: "refunded",
      providerRef: "re_manual",
    });
  });
});

describe("releaseStripeWebhookEventClaim", () => {
  // PAY-M1: the claim is its own committed statement, taken before the handler
  // runs. Without a release, a handler that threw left the row behind and every
  // Stripe redelivery read as a duplicate — the event was marked delivered
  // having never been handled, and `invoice.paid`/`invoice.voided`/
  // `account.application.deauthorized` have no other self-heal.
  it("gives a claim back so the same event id can be claimed and handled again", async () => {
    const { db } = await seededShopContext();
    const input = {
      id: "evt_release_1",
      type: "invoice.paid",
      account: "acct_test",
      occurredAt: nowDate(),
    };
    expect(await claimStripeWebhookEvent(db, input)).toBe(true);
    expect(await claimStripeWebhookEvent(db, input)).toBe(false);

    expect(await releaseStripeWebhookEventClaim(db, input.id)).toBe(true);
    // The redelivery now reaches the handler, which is the whole point.
    expect(await claimStripeWebhookEvent(db, input)).toBe(true);
  });

  it("is a no-op, not an error, when there is no claim to release", async () => {
    const { db } = await seededShopContext();
    expect(await releaseStripeWebhookEventClaim(db, "evt_never_claimed")).toBe(false);
  });

  it("is a no-op the second time, so a double release reports nothing to give back", async () => {
    const { db } = await seededShopContext();
    const input = {
      id: "evt_release_twice",
      type: "invoice.paid",
      account: "acct_test",
      occurredAt: nowDate(),
    };
    await claimStripeWebhookEvent(db, input);
    expect(await releaseStripeWebhookEventClaim(db, input.id)).toBe(true);
    expect(await releaseStripeWebhookEventClaim(db, input.id)).toBe(false);
  });

  it("releases only the named event, leaving every other claim standing", async () => {
    const { db } = await seededShopContext();
    const occurredAt = nowDate();
    await claimStripeWebhookEvent(db, {
      id: "evt_keep",
      type: "invoice.paid",
      account: "acct_test",
      occurredAt,
    });
    await claimStripeWebhookEvent(db, {
      id: "evt_drop",
      type: "invoice.paid",
      account: "acct_test",
      occurredAt,
    });

    await releaseStripeWebhookEventClaim(db, "evt_drop");

    expect(
      await claimStripeWebhookEvent(db, {
        id: "evt_keep",
        type: "invoice.paid",
        account: "acct_test",
        occurredAt,
      }),
    ).toBe(false);
  });

  // The release must never widen into "replays are fine now": a *successfully*
  // handled event keeps its claim forever, so a manual refund made between two
  // deliveries still survives (the test above). This pins the ordering the
  // route depends on — a released claim is only ever a failed one.
  it("a released claim re-runs the handler, so state a failed delivery never wrote is repaired", async () => {
    const { db, shop, bookingId, stripeSessionId } = await paidCheckoutContext();
    const event = {
      id: "evt_release_repair",
      type: "checkout.session.completed",
      account: "acct_test",
      occurredAt: nowDate(),
    };

    // First delivery claims, then the handler throws before writing anything.
    expect(await claimStripeWebhookEvent(db, event)).toBe(true);
    expect(await getBookingPayment(db, shop.id, bookingId)).toBeNull();
    await releaseStripeWebhookEventClaim(db, event.id);

    // Stripe retries the 5xx delivery; this time the handler runs to completion.
    expect(await claimStripeWebhookEvent(db, event)).toBe(true);
    await markCheckoutPaidBySessionId(db, stripeSessionId, "acct_test");
    expect(await getBookingPayment(db, shop.id, bookingId)).toMatchObject({ status: "paid" });
  });
});

describe("hasNewerAccountUpdate", () => {
  it("is false with no claimed account.updated events for the account yet", async () => {
    const { db } = await seededShopContext();
    expect(await hasNewerAccountUpdate(db, "acct_new", "evt_1", nowDate())).toBe(false);
  });

  // Out-of-order delivery: an event Stripe created *earlier* can still arrive
  // at our server *after* one created later — delivery order is not creation
  // order. `account.updated` is otherwise pure last-write-wins, so applying
  // the stale one after the fresh one would regress charges_enabled back to
  // an old value (security review finding).
  it("is true once a chronologically newer account.updated has already been claimed", async () => {
    const { db } = await seededShopContext();
    const older = new Date("2026-07-01T00:00:00.000Z");
    const newer = new Date("2026-07-01T00:05:00.000Z");

    await claimStripeWebhookEvent(db, {
      id: "evt_newer",
      type: "account.updated",
      account: "acct_order",
      occurredAt: newer,
    });

    // The newer event has already been claimed; a delivery of the older one
    // (a different event id) must be recognised as stale.
    expect(await hasNewerAccountUpdate(db, "acct_order", "evt_older", older)).toBe(true);

    // The already-claimed newer event is excluded from its own comparison
    // (`eventId` param) — nothing *else* in the ledger is newer than it.
    expect(await hasNewerAccountUpdate(db, "acct_order", "evt_newer", older)).toBe(false);
  });

  // The regression PAY-M1's first cut introduced, and the reason a released
  // claim keeps its row. A ledger row does two jobs — the dedup claim *and*
  // the chronological evidence this check reads — and deleting it on failure
  // erased both. E1 (newer, charges_enabled:false) fails and releases; E2
  // (older, charges_enabled:true) is then delivered, finds nothing newer, and
  // applies — leaving the shop able to take payments Stripe had disabled,
  // which is fail-open on the flag `canAcceptPayments` gates order and
  // checkout creation with. Stripe gives up retrying E1 after ~3 days, so
  // nothing self-heals it.
  it("still sees a newer event whose own handling failed and released its claim", async () => {
    const { db } = await seededShopContext();
    const older = new Date("2026-07-01T00:00:00.000Z");
    const newer = new Date("2026-07-01T00:05:00.000Z");

    await claimStripeWebhookEvent(db, {
      id: "evt_newer_failed",
      type: "account.updated",
      account: "acct_release_order",
      occurredAt: newer,
    });
    // Its handler threw, so the route gave the claim back.
    expect(await releaseStripeWebhookEventClaim(db, "evt_newer_failed")).toBe(true);

    // The older delivery must still read as stale: the newer event happened,
    // whether or not we managed to apply it.
    expect(await hasNewerAccountUpdate(db, "acct_release_order", "evt_older", older)).toBe(true);

    // And the released event itself is still re-claimable, so Stripe's retry
    // genuinely re-reaches the handler — both jobs, at the same time.
    expect(
      await claimStripeWebhookEvent(db, {
        id: "evt_newer_failed",
        type: "account.updated",
        account: "acct_release_order",
        occurredAt: newer,
      }),
    ).toBe(true);
  });

  // A re-claim must not rewrite `occurred_at` to the redelivery's clock: the
  // stored value is Stripe's own event-creation time and the only ordering
  // evidence there is.
  it("keeps the original occurred_at across a release and re-claim", async () => {
    const { db } = await seededShopContext();
    const older = new Date("2026-07-01T00:00:00.000Z");
    const newer = new Date("2026-07-01T00:05:00.000Z");
    const event = {
      id: "evt_reclaim_time",
      type: "account.updated",
      account: "acct_reclaim",
      occurredAt: newer,
    };

    await claimStripeWebhookEvent(db, event);
    await releaseStripeWebhookEventClaim(db, event.id);
    // The redelivery arrives claiming a *different* (wrong) creation time.
    await claimStripeWebhookEvent(db, { ...event, occurredAt: older });

    expect(await hasNewerAccountUpdate(db, "acct_reclaim", "evt_other", older)).toBe(true);
  });

  it("only compares events for the same connected account", async () => {
    const { db } = await seededShopContext();
    const newer = new Date("2026-07-01T00:05:00.000Z");
    const older = new Date("2026-07-01T00:00:00.000Z");
    await claimStripeWebhookEvent(db, {
      id: "evt_other_account",
      type: "account.updated",
      account: "acct_other",
      occurredAt: newer,
    });
    expect(await hasNewerAccountUpdate(db, "acct_order", "evt_older", older)).toBe(false);
  });
});
