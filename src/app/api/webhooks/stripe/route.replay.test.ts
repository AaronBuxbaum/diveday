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
 * Postgres, which is HD-19's CI job (docs/product/human-decisions.md), a
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
const { bookingCheckouts, orders, tips } = await import("@/db/schema");
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

  it("event types the route deliberately does not consume are inert against settled money", async () => {
    // The dispatch's default arm: `charge.refunded` and `invoice.payment_failed`
    // carry no handler on purpose — refunds move only through the app's own
    // `refundOrder`/`refundBookingOnCancellation`, never off a webhook claim.
    // Pinned here so a future handler for either type has to move this test
    // deliberately, and so "a refund event replayed after the refund row is
    // terminal" is provably a no-op: there is no refund event handler to replay.
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
