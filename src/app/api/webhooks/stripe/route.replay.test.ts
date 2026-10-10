import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { nowMs } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { fakeCheckout } from "@/test/fakes";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

/**
 * Hostile-sequence replay suite: every consumed Stripe event type, delivered
 * through the REAL webhook route (`POST` below, signature verification, the
 * `stripe_webhook_events` claim ledger, livemode cross-check) against the REAL
 * handlers on a real in-memory PGlite database — nothing on the handling path
 * is mocked. The sibling `route.test.ts` mocks every handler to test dispatch;
 * this file is its complement, proving the *sequences* — duplicates,
 * fresh-id redeliveries, out-of-order arrivals, events for checkouts the app
 * gave up on — all converge on the same terminal state as the clean ordering.
 *
 * **What this file can and cannot prove.** PGlite is single-connection, so
 * every sequence here is a *sequential* replay: delivery A fully commits
 * before delivery B starts. That exercises ordering, duplication, and
 * state-machine refusal perfectly — Stripe's at-least-once/any-order contract
 * is exactly a sequence of committed deliveries — but it can NOT exercise two
 * transactions genuinely racing on the same row (`FOR UPDATE` contention,
 * claim upsert races). Those concurrency guards need real multi-connection
 * Postgres, which is HD-19's CI job (docs/product/human-decisions/README.md), a
 * human spend decision outside this suite's scope. Do not mistake green here
 * for race coverage.
 */

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { getDb } = await import("@/db/client");
const { createBookingParty } = await import("@/db/bookings");
const { markCheckoutExpiredBySessionId, startBookingCheckout } = await import("@/db/checkouts");
const { createOrder, refundOrder } = await import("@/db/orders");
const { getBookingPayment, listBookingPaymentEvents, setBookingPayment } = await import(
  "@/db/payments"
);
const { bookingCheckouts, integrationEvents, orders, paymentDisputes, tips } = await import(
  "@/db/schema"
);
const {
  listStuckPaymentOperations,
  recordPaymentOperationStripeObject,
  resolvePaymentOperation,
  startPaymentOperation,
} = await import("@/db/payment-operations");
const { paymentOperationIntents } = await import("@/db/schema");
const { refundBookingOnShopCancellation } = await import("@/db/refunds");
const { listOpenPaymentDisputes } = await import("@/db/payment-disputes");
const { getShopStripeAccount, setShopStripeAccountStatus, upsertShopStripeAccount } = await import(
  "@/db/stripe-accounts"
);
const { startTipCheckout } = await import("@/db/tips");
const { upcomingTripsWithCounts, updateTrip } = await import("@/db/trips");
const { POST } = await import("./route");

type Db = Awaited<ReturnType<typeof seededShopContext>>["db"];

const secret = "whsec_replay";
const ACCOUNT = "acct_replay";
const REEF_PRICE_CENTS = 18_000;

/** Deliver one event through the real route, signed like Stripe signs it. */
async function deliver(event: Record<string, unknown>): Promise<Response> {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
  vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", "");
  const payload = JSON.stringify({ livemode: true, account: ACCOUNT, ...event });
  const timestamp = Math.floor(nowMs() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return POST(
    new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
      body: payload,
    }),
  );
}

function completedPaid(id: string, sessionId: string, amountTotal: number | null = null) {
  return {
    id,
    type: "checkout.session.completed",
    created: Math.floor(nowMs() / 1000),
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        ...(amountTotal !== null ? { amount_total: amountTotal } : {}),
      },
    },
  };
}

function completedUnpaid(id: string, sessionId: string) {
  return {
    id,
    type: "checkout.session.completed",
    created: Math.floor(nowMs() / 1000),
    data: { object: { id: sessionId, payment_status: "unpaid" } },
  };
}

function asyncSucceeded(id: string, sessionId: string, amountTotal: number) {
  return {
    id,
    type: "checkout.session.async_payment_succeeded",
    created: Math.floor(nowMs() / 1000),
    data: { object: { id: sessionId, amount_total: amountTotal } },
  };
}

function asyncFailed(id: string, sessionId: string) {
  return {
    id,
    type: "checkout.session.async_payment_failed",
    created: Math.floor(nowMs() / 1000),
    data: { object: { id: sessionId } },
  };
}

function sessionExpired(id: string, sessionId: string) {
  return {
    id,
    type: "checkout.session.expired",
    created: Math.floor(nowMs() / 1000),
    data: { object: { id: sessionId } },
  };
}

function invoicePaid(id: string, invoiceId: string, amountPaid: number) {
  return {
    id,
    type: "invoice.paid",
    created: Math.floor(nowMs() / 1000),
    data: { object: { id: invoiceId, amount_paid: amountPaid } },
  };
}

function invoiceVoided(id: string, invoiceId: string) {
  return {
    id,
    type: "invoice.voided",
    created: Math.floor(nowMs() / 1000),
    data: { object: { id: invoiceId } },
  };
}

/** A connected, charges-enabled shop wired as the route's own database. */
async function connectedShop() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db as never);
  await upsertShopStripeAccount(db, shop.id, ACCOUNT);
  await setShopStripeAccountStatus(db, ACCOUNT, {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  return { db, shop };
}

async function pricedReef(db: Db, shopId: string) {
  const trips = await upcomingTripsWithCounts(db, shopId, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  await updateTrip(db, shopId, reef.id, {
    title: reef.title,
    startsAt: reef.startsAt,
    endsAt: reef.endsAt,
    capacity: reef.capacity,
    plannedDives: reef.plannedDives,
    priceCents: REEF_PRICE_CENTS,
  });
  return reef;
}

/** One diver, one pending checkout (`cs_1`) on the shop's connected account. */
async function checkoutScenario() {
  const { db, shop } = await connectedShop();
  const reef = await pricedReef(db, shop.id);
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Replay Diver",
      email: "replay@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;
  const start = await startBookingCheckout(
    db,
    {
      shopId: shop.id,
      tripId: reef.id,
      bookingIds: [bookingId],
      customerEmail: "replay@example.com",
      successUrl: "https://diveday.example/return",
      cancelUrl: "https://diveday.example/cancel",
      describeLine: ({ tripTitle }) => tripTitle,
    },
    fakeCheckout(),
  );
  if (!start.ok) throw new Error("checkout start failed");
  return { db, shop, reef, bookingId, sessionId: start.checkout.stripeSessionId };
}

/**
 * Everything a hostile delivery could corrupt, in one comparable shape —
 * checkout status, recorded settlement, the booking's payment row, and the
 * append-only money trail. Ids are deliberately excluded so terminal states
 * are deep-comparable across two independent databases.
 */
async function checkoutTerminal(db: Db, shopId: string, sessionId: string, bookingId: string) {
  const [checkout] = await db
    .select()
    .from(bookingCheckouts)
    .where(eq(bookingCheckouts.stripeSessionId, sessionId))
    .limit(1);
  const payment = await getBookingPayment(db, shopId, bookingId);
  const trail = await listBookingPaymentEvents(db, shopId, bookingId);
  return {
    checkoutStatus: checkout?.status ?? null,
    settledTotalCents: checkout?.settledTotalCents ?? null,
    paymentStatus: payment?.status ?? null,
    paymentAmountCents: payment?.amountCents ?? null,
    paymentProvider: payment?.provider ?? null,
    trail: trail.map((row) => ({
      status: row.status,
      previousStatus: row.previousStatus,
      operation: row.operation,
      amountCents: row.amountCents,
    })),
  };
}

describe("checkout.session.* hostile sequences (real handlers, real db)", () => {
  it("a settled checkout survives the same completion event replayed twice", async () => {
    const { db, shop, bookingId, sessionId } = await checkoutScenario();

    expect((await deliver(completedPaid("evt_c1", sessionId, REEF_PRICE_CENTS))).status).toBe(200);
    const settled = await checkoutTerminal(db, shop.id, sessionId, bookingId);
    expect(settled.checkoutStatus).toBe("completed");
    expect(settled.paymentStatus).toBe("paid");
    expect(settled.trail).toHaveLength(1);

    // Stripe redelivers the same event id (at-least-once). Twice, for measure.
    expect((await deliver(completedPaid("evt_c1", sessionId, REEF_PRICE_CENTS))).status).toBe(200);
    expect((await deliver(completedPaid("evt_c1", sessionId, REEF_PRICE_CENTS))).status).toBe(200);
    expect(await checkoutTerminal(db, shop.id, sessionId, bookingId)).toEqual(settled);
  });

  it("a second completion under a fresh event id lands on the identical terminal state", async () => {
    const { db, shop, bookingId, sessionId } = await checkoutScenario();
    await deliver(completedPaid("evt_c1", sessionId, REEF_PRICE_CENTS));
    const settled = await checkoutTerminal(db, shop.id, sessionId, bookingId);

    // The claim ledger dedupes ids, not sessions — a distinct id walks past it
    // and must be absorbed by the handler's own idempotent state machine.
    expect((await deliver(completedPaid("evt_c2", sessionId, REEF_PRICE_CENTS))).status).toBe(200);
    expect(await checkoutTerminal(db, shop.id, sessionId, bookingId)).toEqual(settled);
  });

  it("async settlement delivered in reverse order ends exactly where the clean order ends", async () => {
    // Clean ordering: session completes unpaid (async method), money settles later.
    const clean = await checkoutScenario();
    await deliver(completedUnpaid("evt_o1", clean.sessionId));
    await deliver(asyncSucceeded("evt_o2", clean.sessionId, REEF_PRICE_CENTS));
    const cleanTerminal = await checkoutTerminal(
      clean.db,
      clean.shop.id,
      clean.sessionId,
      clean.bookingId,
    );
    expect(cleanTerminal.paymentStatus).toBe("paid");
    expect(cleanTerminal.settledTotalCents).toBe(REEF_PRICE_CENTS);

    // Hostile ordering: the settlement outruns the completion in delivery.
    const hostile = await checkoutScenario();
    await deliver(asyncSucceeded("evt_r1", hostile.sessionId, REEF_PRICE_CENTS));
    await deliver(completedUnpaid("evt_r2", hostile.sessionId));
    const hostileTerminal = await checkoutTerminal(
      hostile.db,
      hostile.shop.id,
      hostile.sessionId,
      hostile.bookingId,
    );
    expect(hostileTerminal).toEqual(cleanTerminal);
  });

  it("a failed async payment stays failed through a duplicate failure and a late completed(unpaid) replay", async () => {
    const { db, shop, bookingId, sessionId } = await checkoutScenario();
    await deliver(completedUnpaid("evt_f1", sessionId));
    await deliver(asyncFailed("evt_f2", sessionId));
    const failed = await checkoutTerminal(db, shop.id, sessionId, bookingId);
    expect(failed.checkoutStatus).toBe("expired");
    expect(failed.paymentStatus).toBeNull();
    expect(failed.trail).toHaveLength(0);
    const [row] = await db
      .select({ asyncPaymentFailedAt: bookingCheckouts.asyncPaymentFailedAt })
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.stripeSessionId, sessionId));
    expect(row?.asyncPaymentFailedAt).not.toBeNull();

    // Fresh-id duplicate of the failure, then the original completion replayed.
    await deliver(asyncFailed("evt_f3", sessionId));
    await deliver(completedUnpaid("evt_f4", sessionId));
    expect(await checkoutTerminal(db, shop.id, sessionId, bookingId)).toEqual(failed);
  });

  it("an expiry delivered after settlement never demotes the paid checkout", async () => {
    const { db, shop, bookingId, sessionId } = await checkoutScenario();
    await deliver(completedPaid("evt_e1", sessionId, REEF_PRICE_CENTS));
    const settled = await checkoutTerminal(db, shop.id, sessionId, bookingId);

    // Stripe never emits expired for a completed session; a replayed archive of
    // signed events could still present this order, so it must be inert.
    expect((await deliver(sessionExpired("evt_e2", sessionId))).status).toBe(200);
    expect(await checkoutTerminal(db, shop.id, sessionId, bookingId)).toEqual(settled);
  });

  it("a completion for a checkout the app already gave up on is refused, never resurrected", async () => {
    const { db, shop, bookingId, sessionId } = await checkoutScenario();
    // The abandonment path's own write (recovery cron / reschedule retire):
    // locally this session is dead, whatever Stripe still thinks of it.
    await markCheckoutExpiredBySessionId(db, sessionId);

    expect((await deliver(completedPaid("evt_g1", sessionId, REEF_PRICE_CENTS))).status).toBe(200);
    const terminal = await checkoutTerminal(db, shop.id, sessionId, bookingId);
    expect(terminal.checkoutStatus).toBe("expired");
    expect(terminal.paymentStatus).toBeNull();
    expect(terminal.trail).toHaveLength(0);
  });

  it("event types the route does not consume, and a refund of a charge it never made, are inert", async () => {
    // `invoice.payment_failed` reaches the default arm. `charge.refunded` has a
    // handler now (ADR 20261009-stripe-reversals-reach-diveday), but one whose
    // charge names no PaymentIntent DiveDay recorded is somebody else's money
    // — the shop's own till — and must change nothing, replayed or not.
    const { db, shop, bookingId, sessionId } = await checkoutScenario();
    await deliver(completedPaid("evt_n1", sessionId, REEF_PRICE_CENTS));
    const settled = await checkoutTerminal(db, shop.id, sessionId, bookingId);

    const chargeRefunded = {
      id: "evt_n2",
      type: "charge.refunded",
      created: Math.floor(nowMs() / 1000),
      data: { object: { id: "ch_1", amount_refunded: REEF_PRICE_CENTS } },
    };
    const invoiceFailed = {
      id: "evt_n3",
      type: "invoice.payment_failed",
      created: Math.floor(nowMs() / 1000),
      data: { object: { id: "in_1" } },
    };
    expect((await deliver(chargeRefunded)).status).toBe(200);
    expect((await deliver(chargeRefunded)).status).toBe(200); // and its replay
    expect((await deliver(invoiceFailed)).status).toBe(200);
    expect(await checkoutTerminal(db, shop.id, sessionId, bookingId)).toEqual(settled);
  });

  it("events for a session the app never knew are acknowledged and change nothing", async () => {
    const { db, shop, bookingId, sessionId } = await checkoutScenario();
    const before = await checkoutTerminal(db, shop.id, sessionId, bookingId);

    expect((await deliver(completedPaid("evt_u1", "cs_ghost", 5_000))).status).toBe(200);
    expect((await deliver(sessionExpired("evt_u2", "cs_ghost"))).status).toBe(200);
    expect((await deliver(asyncFailed("evt_u3", "cs_ghost"))).status).toBe(200);
    expect((await deliver(asyncSucceeded("evt_u4", "cs_ghost", 5_000))).status).toBe(200);

    expect(await checkoutTerminal(db, shop.id, sessionId, bookingId)).toEqual(before);
  });
});

describe("tip session hostile sequences (real handlers, real db)", () => {
  /** One tip session (`cs_1`), no booking checkout sharing the id space. */
  async function tipScenario() {
    const { db, shop } = await connectedShop();
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Tip Replay",
        email: "tip-replay@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const bookingId = party.bookings[0].bookingId;
    const outcome = await startTipCheckout(
      db,
      {
        bookingId,
        amountCents: 2_000,
        successUrl: "https://diveday.example/recap/tok?tip=paid",
        cancelUrl: "https://diveday.example/recap/tok?tip=cancelled",
        lineDescription: "CALLER_TIP_LABEL",
      },
      fakeCheckout(),
    );
    if (!outcome.ok) throw new Error(`tip start failed: ${outcome.reason}`);
    return { db, shop, bookingId };
  }

  async function tipState(db: Db) {
    const [tip] = await db.select().from(tips).where(eq(tips.stripeSessionId, "cs_1")).limit(1);
    return { status: tip?.status ?? null, completedAt: tip?.completedAt ?? null };
  }

  it("a tip completion replayed under both id flavors, then an expiry, leaves the tip paid once", async () => {
    const { db, shop, bookingId } = await tipScenario();

    expect((await deliver(completedPaid("evt_t1", "cs_1"))).status).toBe(200);
    const paid = await tipState(db);
    expect(paid.status).toBe("paid");

    await deliver(completedPaid("evt_t1", "cs_1")); // same-id redelivery
    await deliver(completedPaid("evt_t2", "cs_1")); // fresh-id redelivery
    await deliver(sessionExpired("evt_t3", "cs_1")); // late expiry after settlement
    expect(await tipState(db)).toEqual(paid);

    // A tip never touches the booking payment gate, replayed or not.
    expect(await getBookingPayment(db, shop.id, bookingId)).toBeNull();
  });

  it("a failed async tip payment expires the tip and stays expired through replays", async () => {
    const { db } = await tipScenario();
    await deliver(completedUnpaid("evt_t4", "cs_1"));
    await deliver(asyncFailed("evt_t5", "cs_1"));
    expect((await tipState(db)).status).toBe("expired");

    await deliver(asyncFailed("evt_t6", "cs_1"));
    await deliver(completedUnpaid("evt_t7", "cs_1"));
    expect((await tipState(db)).status).toBe("expired");
  });
});

describe("invoice.* hostile sequences (real handlers, real db)", () => {
  /** One open Stripe-invoiced order (`in_1`) linked to a fresh booking. */
  async function orderScenario() {
    const { db, shop } = await connectedShop();
    const reef = await pricedReef(db, shop.id);
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Invoice Replay",
        email: "invoice-replay@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const bookingId = party.bookings[0].bookingId;
    const personId = party.bookings[0].personId;
    const staff = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const created = await createOrder(
      db,
      {
        shopId: shop.id,
        personId,
        createdByPersonId: staff,
        bookingId,
        lineItems: [
          {
            kind: "trip_fee",
            description: "Two-tank charter",
            quantity: 1,
            unitAmountCents: 22_000,
          },
        ],
      },
      invoicing(),
    );
    if (!created.ok) throw new Error(`order failed: ${created.reason}`);
    return { db, shop, bookingId, order: created.order };
  }

  /** Minimal invoicing fake — enough to mint `in_1` and refund it. */
  function invoicing() {
    return {
      async createInvoice(request: {
        lineItems: Array<{ quantity: number; unitAmountCents: number }>;
      }) {
        return {
          status: "created" as const,
          stripeCustomerId: "cus_1",
          stripeInvoiceId: "in_1",
          stripeStatus: "open",
          hostedInvoiceUrl: "https://invoice.stripe.com/i/in_1",
          invoicePdfUrl: null,
          totalCents: request.lineItems.reduce(
            (sum, item) => sum + item.quantity * item.unitAmountCents,
            0,
          ),
          taxCents: 0,
        };
      },
      async voidInvoice() {
        return { status: "voided" as const };
      },
      async refundInvoice() {
        return { status: "refunded" as const, refundId: "re_1" };
      },
      async retrieveInvoice() {
        return { status: "failed" as const };
      },
      async resendInvoice() {
        return { status: "sent" as const };
      },
    };
  }

  async function orderTerminal(db: Db, shopId: string, orderId: string, bookingId: string) {
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const payment = await getBookingPayment(db, shopId, bookingId);
    const trail = await listBookingPaymentEvents(db, shopId, bookingId);
    return {
      orderStatus: order?.status ?? null,
      amountPaidCents: order?.amountPaidCents ?? null,
      paymentStatus: payment?.status ?? null,
      paymentAmountCents: payment?.amountCents ?? null,
      trail: trail.map((row) => ({
        status: row.status,
        previousStatus: row.previousStatus,
        operation: row.operation,
        amountCents: row.amountCents,
      })),
    };
  }

  it("invoice.paid settles once through same-id and fresh-id redeliveries", async () => {
    const { db, shop, bookingId, order } = await orderScenario();
    expect((await deliver(invoicePaid("evt_i1", "in_1", 22_000))).status).toBe(200);
    const settled = await orderTerminal(db, shop.id, order.id, bookingId);
    expect(settled.orderStatus).toBe("paid");
    expect(settled.paymentStatus).toBe("paid");
    expect(settled.trail).toHaveLength(1);

    await deliver(invoicePaid("evt_i1", "in_1", 22_000)); // same id
    await deliver(invoicePaid("evt_i2", "in_1", 22_000)); // fresh id
    expect(await orderTerminal(db, shop.id, order.id, bookingId)).toEqual(settled);
  });

  it("a late invoice.paid can never reopen a voided order", async () => {
    const { db, shop, bookingId, order } = await orderScenario();
    await deliver(invoiceVoided("evt_v1", "in_1"));
    const voided = await orderTerminal(db, shop.id, order.id, bookingId);
    expect(voided.orderStatus).toBe("void");
    expect(voided.paymentStatus).toBeNull();

    expect((await deliver(invoicePaid("evt_v2", "in_1", 22_000))).status).toBe(200);
    expect(await orderTerminal(db, shop.id, order.id, bookingId)).toEqual(voided);
  });

  it("a late invoice.voided can never undo a settled order or its booking", async () => {
    const { db, shop, bookingId, order } = await orderScenario();
    await deliver(invoicePaid("evt_w1", "in_1", 22_000));
    const settled = await orderTerminal(db, shop.id, order.id, bookingId);

    expect((await deliver(invoiceVoided("evt_w2", "in_1"))).status).toBe(200);
    expect(await orderTerminal(db, shop.id, order.id, bookingId)).toEqual(settled);
  });

  it("an invoice.paid replayed after the refund is terminal leaves everything refunded", async () => {
    const { db, shop, bookingId, order } = await orderScenario();
    await deliver(invoicePaid("evt_x1", "in_1", 22_000));
    const refunded = await refundOrder(db, shop.id, order.id, invoicing());
    expect(refunded.status).toBe("refunded");
    const terminal = await orderTerminal(db, shop.id, order.id, bookingId);
    expect(terminal.orderStatus).toBe("refunded");
    expect(terminal.paymentStatus).toBe("refunded");

    // Stripe's retry horizon is days; the refund happened in between.
    expect((await deliver(invoicePaid("evt_x2", "in_1", 22_000))).status).toBe(200);
    expect(await orderTerminal(db, shop.id, order.id, bookingId)).toEqual(terminal);
  });

  it("a waived booking survives its invoice settling — the order pays, the waiver stands", async () => {
    const { db, shop, bookingId, order } = await orderScenario();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "waived",
      currency: "usd",
    });

    expect((await deliver(invoicePaid("evt_y1", "in_1", 22_000))).status).toBe(200);
    const terminal = await orderTerminal(db, shop.id, order.id, bookingId);
    // The order itself settled — Stripe really was paid — but the human
    // decision on the booking is final against a machine writer.
    expect(terminal.orderStatus).toBe("paid");
    expect(terminal.paymentStatus).toBe("waived");
  });

  it("an invoice.paid for an invoice the app never raised is acknowledged and changes nothing", async () => {
    const { db, shop, bookingId, order } = await orderScenario();
    const before = await orderTerminal(db, shop.id, order.id, bookingId);
    expect((await deliver(invoicePaid("evt_z1", "in_ghost", 9_900))).status).toBe(200);
    expect(await orderTerminal(db, shop.id, order.id, bookingId)).toEqual(before);
  });
});

describe("account.* hostile sequences (real handlers, real db)", () => {
  it("an older account.updated delivered after a newer one is refused, and its replay too", async () => {
    const { db, shop } = await connectedShop();
    const now = Math.floor(nowMs() / 1000);

    // Newest truth: Stripe disabled charges.
    const newer = {
      id: "evt_a_newer",
      type: "account.updated",
      created: now,
      data: {
        object: {
          id: ACCOUNT,
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: true,
        },
      },
    };
    // Chronologically older event saying charges were still enabled.
    const older = {
      id: "evt_a_older",
      type: "account.updated",
      created: now - 600,
      data: {
        object: {
          id: ACCOUNT,
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
        },
      },
    };

    expect((await deliver(newer)).status).toBe(200);
    expect((await deliver(older)).status).toBe(200);
    expect((await deliver(older)).status).toBe(200); // same-id replay of the stale one

    const account = await getShopStripeAccount(db, shop.id);
    expect(account?.chargesEnabled).toBe(false);
    expect(account?.payoutsEnabled).toBe(false);
  });

  it("a deauthorization that predates the current connection leaves the live account alone", async () => {
    const { db, shop } = await connectedShop();
    const now = Math.floor(nowMs() / 1000);

    // The shop disconnected and reconnected; this event describes the OLD
    // connection's death, redelivered days later by Stripe's retry queue.
    const stale = {
      id: "evt_d_stale",
      type: "account.application.deauthorized",
      created: now - 3600,
      data: { object: {} },
    };
    expect((await deliver(stale)).status).toBe(200);
    const stillConnected = await getShopStripeAccount(db, shop.id);
    expect(stillConnected?.disconnectedAt).toBeNull();
    expect(stillConnected?.chargesEnabled).toBe(true);

    // A genuine deauthorization after the connection was made does apply.
    const genuine = {
      id: "evt_d_fresh",
      type: "account.application.deauthorized",
      created: now + 60,
      data: { object: {} },
    };
    expect((await deliver(genuine)).status).toBe(200);
    const disconnected = await getShopStripeAccount(db, shop.id);
    expect(disconnected?.disconnectedAt).not.toBeNull();
    expect(disconnected?.chargesEnabled).toBe(false);

    // And its own replay is a no-op on the already-dead row.
    expect((await deliver(genuine)).status).toBe(200);
    expect((await getShopStripeAccount(db, shop.id))?.disconnectedAt).toEqual(
      disconnected?.disconnectedAt,
    );
  });
});

describe("charge.refunded hostile sequences (real handlers, real db)", () => {
  // ADR 20261009-stripe-reversals-reach-diveday: a refund made in the shop's
  // Stripe dashboard reaches the order, the seat, Reports and the integrations;
  // a refund DiveDay made itself is never counted twice.

  function chargeRefunded(
    id: string,
    paymentIntent: string,
    amountRefunded: number,
    ageSeconds = 0,
  ) {
    return {
      id,
      type: "charge.refunded",
      created: Math.floor(nowMs() / 1000) - ageSeconds,
      data: {
        object: {
          id: `ch_for_${paymentIntent}`,
          payment_intent: paymentIntent,
          amount_refunded: amountRefunded,
        },
      },
    };
  }

  function invoicePaidWithIntent(id: string, invoiceId: string, amountPaid: number, pi: string) {
    const event = invoicePaid(id, invoiceId, amountPaid);
    return {
      ...event,
      data: {
        object: {
          ...event.data.object,
          payments: {
            data: [{ is_default: true, status: "paid", payment: { payment_intent: pi } }],
          },
        },
      },
    };
  }

  async function orderScenario() {
    const { db, shop } = await connectedShop();
    const reef = await pricedReef(db, shop.id);
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Dashboard Refund",
        email: "dashboard-refund@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const bookingId = party.bookings[0].bookingId;
    const staff = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const created = await createOrder(
      db,
      {
        shopId: shop.id,
        personId: party.bookings[0].personId,
        createdByPersonId: staff,
        bookingId,
        lineItems: [
          { kind: "trip_fee", description: "Charter", quantity: 1, unitAmountCents: 22_000 },
        ],
      },
      {
        async createInvoice() {
          return {
            status: "created" as const,
            stripeCustomerId: "cus_1",
            stripeInvoiceId: "in_r1",
            stripeStatus: "open",
            hostedInvoiceUrl: "https://invoice.stripe.com/i/in_r1",
            invoicePdfUrl: null,
            totalCents: 22_000,
            taxCents: 0,
          };
        },
        async voidInvoice() {
          return { status: "voided" as const };
        },
        async refundInvoice() {
          return { status: "failed" as const };
        },
        async retrieveInvoice() {
          return { status: "failed" as const };
        },
        async resendInvoice() {
          return { status: "sent" as const };
        },
      },
    );
    if (!created.ok) throw new Error(`order failed: ${created.reason}`);
    return { db, shop, bookingId, order: created.order };
  }

  async function orderMoney(db: Db, shopId: string, orderId: string, bookingId: string) {
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const payment = await getBookingPayment(db, shopId, bookingId);
    const trail = await listBookingPaymentEvents(db, shopId, bookingId);
    const refundEvents = await db
      .select({ key: integrationEvents.idempotencyKey })
      .from(integrationEvents)
      .where(eq(integrationEvents.eventType, "order.refunded"));
    return {
      orderStatus: order?.status ?? null,
      amountPaidCents: order?.amountPaidCents ?? null,
      refundedCents: order?.refundedCents ?? null,
      paymentStatus: payment?.status ?? null,
      paymentAmountCents: payment?.amountCents ?? null,
      operations: trail.map((row) => row.operation),
      integrationRefunds: refundEvents.map((row) => row.key).sort(),
    };
  }

  it("a dashboard refund reaches the order, the seat and the integrations, once", async () => {
    const { db, shop, bookingId, order } = await orderScenario();
    await deliver(invoicePaidWithIntent("evt_rp1", "in_r1", 22_000, "pi_order"));

    expect((await deliver(chargeRefunded("evt_rf1", "pi_order", 5_000))).status).toBe(200);
    const partly = await orderMoney(db, shop.id, order.id, bookingId);
    expect(partly).toMatchObject({
      orderStatus: "partly_refunded",
      amountPaidCents: 17_000,
      refundedCents: 5_000,
      paymentStatus: "partly_refunded",
      paymentAmountCents: 17_000,
    });
    expect(partly.operations).toContain("stripe_dashboard_refund");
    expect(partly.integrationRefunds).toEqual([`order:${order.id}:refund:5000`]);

    // Same-id and fresh-id redeliveries carry a cumulative already reached.
    await deliver(chargeRefunded("evt_rf1", "pi_order", 5_000));
    await deliver(chargeRefunded("evt_rf2", "pi_order", 5_000));
    expect(await orderMoney(db, shop.id, order.id, bookingId)).toEqual(partly);

    // A second dashboard refund takes the rest.
    await deliver(chargeRefunded("evt_rf3", "pi_order", 22_000));
    const full = await orderMoney(db, shop.id, order.id, bookingId);
    expect(full).toMatchObject({
      orderStatus: "refunded",
      amountPaidCents: 0,
      refundedCents: 22_000,
      paymentStatus: "refunded",
    });

    // The first refund's event, delivered late, never reverses a reversal.
    expect((await deliver(chargeRefunded("evt_rf4", "pi_order", 5_000, 600))).status).toBe(200);
    expect(await orderMoney(db, shop.id, order.id, bookingId)).toEqual(full);
  });

  it("DiveDay's own refund, echoed back by Stripe, is not counted twice", async () => {
    const { db, shop, bookingId, order } = await orderScenario();
    await deliver(invoicePaidWithIntent("evt_ro1", "in_r1", 22_000, "pi_own"));
    const refunded = await refundOrder(
      db,
      shop.id,
      order.id,
      {
        async createInvoice() {
          return { status: "failed" as const };
        },
        async voidInvoice() {
          return { status: "failed" as const };
        },
        async refundInvoice() {
          return { status: "refunded" as const, refundId: "re_own", amountCents: 8_000 };
        },
        async retrieveInvoice() {
          return { status: "failed" as const };
        },
        async resendInvoice() {
          return { status: "failed" as const };
        },
      },
      { amountCents: 8_000 },
    );
    expect(refunded.status).toBe("refunded");
    const before = await orderMoney(db, shop.id, order.id, bookingId);
    expect(before.refundedCents).toBe(8_000);

    expect((await deliver(chargeRefunded("evt_ro2", "pi_own", 8_000))).status).toBe(200);
    expect(await orderMoney(db, shop.id, order.id, bookingId)).toEqual(before);
  });

  it("waits while DiveDay's own refund of the same order is mid-flight, then applies", async () => {
    const { db, shop, bookingId, order } = await orderScenario();
    await deliver(invoicePaidWithIntent("evt_rw1", "in_r1", 22_000, "pi_wait"));
    // A staffer's refund is at Stripe right now: its intent is committed, its
    // local write is not. This event may be that refund's own echo.
    const intent = await startPaymentOperation(db, {
      shopId: shop.id,
      kind: "refund",
      orderId: order.id,
    });
    const before = await orderMoney(db, shop.id, order.id, bookingId);

    const waited = await deliver(chargeRefunded("evt_rw2", "pi_wait", 4_000));
    expect(waited.status).toBe(503);
    expect(await orderMoney(db, shop.id, order.id, bookingId)).toEqual(before);

    // DiveDay's attempt failed at Stripe, so the 4,000 is somebody else's
    // refund. Stripe's redelivery of the *same* event now lands.
    await resolvePaymentOperation(db, intent.id, { status: "failed", errorMessage: "failed" });
    expect((await deliver(chargeRefunded("evt_rw2", "pi_wait", 4_000))).status).toBe(200);
    expect((await orderMoney(db, shop.id, order.id, bookingId)).refundedCents).toBe(4_000);
  });

  it("a refund that outruns its invoice's settlement waits for it rather than vanishing", async () => {
    const { db, shop, bookingId, order } = await orderScenario();
    // The PaymentIntent is known (Stripe's lookup would say so); simulate the
    // refund arriving while the order is still open here.
    await db
      .update(orders)
      .set({ stripePaymentIntentId: "pi_early" })
      .where(eq(orders.id, order.id));
    expect((await deliver(chargeRefunded("evt_re1", "pi_early", 2_000))).status).toBe(503);

    await deliver(invoicePaidWithIntent("evt_re2", "in_r1", 22_000, "pi_early"));
    expect((await deliver(chargeRefunded("evt_re1", "pi_early", 2_000))).status).toBe(200);
    expect(await orderMoney(db, shop.id, order.id, bookingId)).toMatchObject({
      orderStatus: "partly_refunded",
      refundedCents: 2_000,
      amountPaidCents: 20_000,
    });
  });

  it("another connected account's event never touches this shop's order", async () => {
    const { db, shop, bookingId, order } = await orderScenario();
    await deliver(invoicePaidWithIntent("evt_ra1", "in_r1", 22_000, "pi_mine"));
    const before = await orderMoney(db, shop.id, order.id, bookingId);
    const foreign = {
      ...chargeRefunded("evt_ra2", "pi_mine", 22_000),
      account: "acct_someone_else",
    };
    expect((await deliver(foreign)).status).toBe(200);
    expect(await orderMoney(db, shop.id, order.id, bookingId)).toEqual(before);
  });

  function completedWithIntent(id: string, sessionId: string, pi: string) {
    const event = completedPaid(id, sessionId, REEF_PRICE_CENTS);
    return { ...event, data: { object: { ...event.data.object, payment_intent: pi } } };
  }

  it("a dashboard refund on a one-seat checkout reaches the seat; DiveDay's own then adds only the rest", async () => {
    const { db, shop, bookingId, sessionId } = await checkoutScenario();
    await deliver(completedWithIntent("evt_cr1", sessionId, "pi_seat"));

    expect((await deliver(chargeRefunded("evt_cr2", "pi_seat", 3_000))).status).toBe(200);
    const partly = await checkoutTerminal(db, shop.id, sessionId, bookingId);
    expect(partly.paymentStatus).toBe("partly_refunded");
    expect(partly.paymentAmountCents).toBe(REEF_PRICE_CENTS - 3_000);
    // Newest first.
    expect(partly.trail[0]?.operation).toBe("stripe_dashboard_refund");

    // The shop then calls the departure off: DiveDay reverses what the seat
    // still holds, and counts it on the checkout.
    const own = await refundBookingOnShopCancellation(
      db,
      { shopId: shop.id, bookingId },
      fakeCheckout(),
    );
    expect(own).toEqual({ status: "refunded", amountCents: REEF_PRICE_CENTS - 3_000 });
    const after = await checkoutTerminal(db, shop.id, sessionId, bookingId);

    // Stripe's echo of that refund carries the whole fare as its cumulative.
    expect((await deliver(chargeRefunded("evt_cr3", "pi_seat", REEF_PRICE_CENTS))).status).toBe(
      200,
    );
    expect(await checkoutTerminal(db, shop.id, sessionId, bookingId)).toEqual(after);
    const [checkout] = await db
      .select({ refundedCents: bookingCheckouts.refundedCents })
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.stripeSessionId, sessionId));
    expect(checkout?.refundedCents).toBe(REEF_PRICE_CENTS);
  });

  it("a party checkout's dashboard refund names no seat, so none is guessed at", async () => {
    const { db, shop } = await connectedShop();
    const reef = await pricedReef(db, shop.id);
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Party One",
        email: "p1@example.com",
      },
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Party Two",
        email: "p2@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const bookingIds = party.bookings.map((b) => b.bookingId);
    const start = await startBookingCheckout(
      db,
      {
        shopId: shop.id,
        tripId: reef.id,
        bookingIds,
        customerEmail: "p1@example.com",
        successUrl: "https://diveday.example/return",
        cancelUrl: "https://diveday.example/cancel",
        describeLine: ({ tripTitle }) => tripTitle,
      },
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    const sessionId = start.checkout.stripeSessionId;
    await deliver(completedWithIntent("evt_cp1", sessionId, "pi_party"));
    const seatsBefore = await Promise.all(
      bookingIds.map((id) => getBookingPayment(db, shop.id, id)),
    );

    expect((await deliver(chargeRefunded("evt_cp2", "pi_party", 5_000))).status).toBe(200);
    const seatsAfter = await Promise.all(
      bookingIds.map((id) => getBookingPayment(db, shop.id, id)),
    );
    expect(seatsAfter.map((p) => [p?.status, p?.amountCents])).toEqual(
      seatsBefore.map((p) => [p?.status, p?.amountCents]),
    );
    const [checkout] = await db
      .select({ refundedCents: bookingCheckouts.refundedCents })
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.stripeSessionId, sessionId));
    expect(checkout?.refundedCents).toBe(5_000);
  });

  /** Every `started` refund intent this shop holds, however fresh. */
  async function stuckRefunds(db: Db, shopId: string) {
    // Any age: `started_at` is the database clock, which the frozen test clock is not.
    const stuck = await listStuckPaymentOperations(db, shopId, new Date("2100-01-01T00:00:00Z"));
    return stuck
      .map((op) => op.intent)
      .filter((intent) => intent.kind === "refund")
      .map((intent) => ({
        orderId: intent.orderId,
        checkoutId: intent.checkoutId,
        bookingId: intent.bookingId,
        stripeObjectId: intent.stripeObjectId,
      }));
  }

  async function partyScenario() {
    const { db, shop } = await connectedShop();
    const reef = await pricedReef(db, shop.id);
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Party A",
        email: "pa@example.com",
      },
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Party B",
        email: "pb@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const bookingIds = party.bookings.map((b) => b.bookingId);
    const start = await startBookingCheckout(
      db,
      {
        shopId: shop.id,
        tripId: reef.id,
        bookingIds,
        customerEmail: "pa@example.com",
        successUrl: "https://diveday.example/return",
        cancelUrl: "https://diveday.example/cancel",
        describeLine: ({ tripTitle }) => tripTitle,
      },
      fakeCheckout(),
    );
    if (!start.ok) throw new Error("checkout start failed");
    return { db, shop, bookingIds, checkout: start.checkout };
  }

  it("a party checkout's unattributed dashboard refund goes to the stuck queue, and no seat is refunded on top of it", async () => {
    const { db, shop, bookingIds, checkout } = await partyScenario();
    await deliver(completedWithIntent("evt_pu1", checkout.stripeSessionId, "pi_pu"));
    expect((await deliver(chargeRefunded("evt_pu2", "pi_pu", 5_000))).status).toBe(200);

    // A human matches it to a seat, from the queue every stuck Stripe call uses.
    expect(await stuckRefunds(db, shop.id)).toEqual([
      { orderId: null, checkoutId: checkout.id, bookingId: null, stripeObjectId: "ch_for_pi_pu" },
    ]);
    // A replay is the same refund, not a second one.
    await deliver(chargeRefunded("evt_pu2", "pi_pu", 5_000));
    await deliver(chargeRefunded("evt_pu3", "pi_pu", 5_000));
    expect(await stuckRefunds(db, shop.id)).toHaveLength(1);

    // Until then, DiveDay never reverses a seat of that charge itself: the
    // 5,000 may already be this seat's money.
    let asked = 0;
    const outcome = await refundBookingOnShopCancellation(
      db,
      { shopId: shop.id, bookingId: bookingIds[0] as string },
      fakeCheckout({
        async refundCheckoutSession() {
          asked += 1;
          return { status: "refunded" as const, refundId: "re_again" };
        },
      }),
    );
    expect(outcome).toEqual({ status: "needs_reconciliation" });
    expect(asked).toBe(0);
  });

  it("DiveDay's own refund that died after Stripe confirmed it is never counted again, however old", async () => {
    const { db, shop, bookingId, sessionId } = await checkoutScenario();
    await deliver(completedWithIntent("evt_od1", sessionId, "pi_dead"));
    const before = await checkoutTerminal(db, shop.id, sessionId, bookingId);
    const intent = await startPaymentOperation(db, { shopId: shop.id, kind: "refund", bookingId });
    await recordPaymentOperationStripeObject(db, intent.id, "re_dead");
    // Well past the five-minute horizon: the process that held it is gone.
    await db
      .update(paymentOperationIntents)
      .set({ startedAt: new Date(nowMs() - 60 * 60 * 1000) })
      .where(eq(paymentOperationIntents.id, intent.id));

    expect((await deliver(chargeRefunded("evt_od2", "pi_dead", 4_000))).status).toBe(503);
    expect(await checkoutTerminal(db, shop.id, sessionId, bookingId)).toEqual(before);
  });

  it("a reversal still waiting after two days goes to the stuck queue instead of waiting forever", async () => {
    const { db, shop, bookingId, order } = await orderScenario();
    await db
      .update(orders)
      .set({ stripePaymentIntentId: "pi_never" })
      .where(eq(orders.id, order.id));
    const before = await orderMoney(db, shop.id, order.id, bookingId);

    // Fresh: Stripe retries.
    expect((await deliver(chargeRefunded("evt_pk1", "pi_never", 2_000))).status).toBe(503);
    expect(await stuckRefunds(db, shop.id)).toEqual([]);

    // Two days on and still unsettled here: a human looks instead.
    const old = chargeRefunded("evt_pk2", "pi_never", 2_000, 49 * 3_600);
    expect((await deliver(old)).status).toBe(200);
    expect(await stuckRefunds(db, shop.id)).toEqual([
      { orderId: order.id, checkoutId: null, bookingId: null, stripeObjectId: "ch_for_pi_never" },
    ]);
    expect((await deliver(old)).status).toBe(200);
    expect(await stuckRefunds(db, shop.id)).toHaveLength(1);
    expect(await orderMoney(db, shop.id, order.id, bookingId)).toEqual(before);
  });
});

describe("charge.dispute.* hostile sequences (real handlers, real db)", () => {
  function disputeEvent(
    id: string,
    type: string,
    status: string,
    options: { pi?: string; ageSeconds?: number; dueBy?: number | null } = {},
  ) {
    const now = Math.floor(nowMs() / 1000);
    return {
      id,
      type,
      created: now - (options.ageSeconds ?? 0),
      data: {
        object: {
          id: "dp_1",
          amount: REEF_PRICE_CENTS,
          currency: "usd",
          created: now - 3_600,
          status,
          reason: "fraudulent",
          payment_intent: options.pi ?? "pi_disputed",
          evidence_details: {
            due_by: options.dueBy === undefined ? now + 7 * 86_400 : options.dueBy,
          },
        },
      },
    };
  }

  it("a dispute opens on the checkout, survives a late update after closing, and clears when decided", async () => {
    const { db, shop, sessionId } = await checkoutScenario();
    const completed = completedPaid("evt_d0", sessionId, REEF_PRICE_CENTS);
    await deliver({
      ...completed,
      data: { object: { ...completed.data.object, payment_intent: "pi_disputed" } },
    });

    expect(
      (await deliver(disputeEvent("evt_d1", "charge.dispute.created", "needs_response"))).status,
    ).toBe(200);
    const open = await listOpenPaymentDisputes(db, shop.id);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      amountCents: REEF_PRICE_CENTS,
      currency: "usd",
      personName: "Replay Diver",
    });
    expect(open[0]?.evidenceDueBy).toBeInstanceOf(Date);
    expect(open[0]?.tripTitle).toMatch(/^Two-Tank Reef/);

    // Replays are no-ops.
    await deliver(disputeEvent("evt_d1", "charge.dispute.created", "needs_response"));
    expect(await listOpenPaymentDisputes(db, shop.id)).toEqual(open);

    expect((await deliver(disputeEvent("evt_d2", "charge.dispute.closed", "won"))).status).toBe(
      200,
    );
    expect(await listOpenPaymentDisputes(db, shop.id)).toEqual([]);

    // An `updated` from before the close, delivered after it, never reopens it.
    await deliver(
      disputeEvent("evt_d3", "charge.dispute.updated", "under_review", { ageSeconds: 600 }),
    );
    expect(await listOpenPaymentDisputes(db, shop.id)).toEqual([]);
    const [row] = await db
      .select()
      .from(paymentDisputes)
      .where(eq(paymentDisputes.stripeDisputeId, "dp_1"));
    expect(row?.status).toBe("won");
    expect(row?.closedAt).not.toBeNull();
  });

  it("an update stamped the same second as the close never reopens it", async () => {
    const { db, shop, sessionId } = await checkoutScenario();
    const completed = completedPaid("evt_e0", sessionId, REEF_PRICE_CENTS);
    await deliver({
      ...completed,
      data: { object: { ...completed.data.object, payment_intent: "pi_disputed" } },
    });
    await deliver(
      disputeEvent("evt_e1", "charge.dispute.created", "needs_response", { ageSeconds: 60 }),
    );
    await deliver(disputeEvent("evt_e2", "charge.dispute.closed", "lost"));
    await deliver(disputeEvent("evt_e3", "charge.dispute.updated", "under_review"));
    expect(await listOpenPaymentDisputes(db, shop.id)).toEqual([]);
    const [row] = await db
      .select()
      .from(paymentDisputes)
      .where(eq(paymentDisputes.stripeDisputeId, "dp_1"));
    expect(row?.status).toBe("lost");
  });

  it("a dispute on a charge DiveDay never made is not recorded", async () => {
    const { db } = await connectedShop();
    expect(
      (
        await deliver(
          disputeEvent("evt_dx", "charge.dispute.created", "needs_response", { pi: "pi_till" }),
        )
      ).status,
    ).toBe(200);
    expect(await db.select().from(paymentDisputes)).toEqual([]);
  });
});
