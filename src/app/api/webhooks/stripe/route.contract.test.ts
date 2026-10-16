import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nowMs } from "@/lib/clock";
import {
  type StripeEventFixture,
  stripeEventFixture,
  stripeEventFixtureRaw,
} from "@/lib/payments/__fixtures__/stripe";

/**
 * The webhook route, driven by **real-shaped Stripe event payloads** instead of
 * the minimal objects `route.test.ts` invents (TEST-M2).
 *
 * `route.test.ts` is the behaviour suite — every dispatch arm, every refusal,
 * every claim/release path — and it stays that way. What it cannot do is notice
 * that a real `checkout.session.completed` nests its object differently from the
 * `{ id, payment_status }` it posts, or that a real `account.updated` carries a
 * `default_currency` the handler would otherwise never see. Its payloads are
 * shaped by the same person who wrote the assertions.
 *
 * So this file replays the fixtures in `src/lib/payments/__fixtures__/stripe/`
 * through the same `POST`, and asserts the values the handlers actually
 * extracted. A shape drift in a payload the route parses by hand
 * (`invoiceObjectSchema`, `checkoutSessionObjectSchema`, `accountObjectSchema`
 * are all private to route.ts, reachable only this way) fails here.
 */

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/checkouts", () => ({
  markCheckoutPaidBySessionId: vi.fn(),
  markCheckoutExpiredBySessionId: vi.fn(),
  markCheckoutPaymentFailedBySessionId: vi.fn(),
  recordCheckoutStripeCustomer: vi.fn(),
  recordCheckoutPaymentIntent: vi.fn(),
}));
vi.mock("@/db/tips", () => ({
  markTipPaidBySessionId: vi.fn(),
  markTipExpiredBySessionId: vi.fn(),
  recordTipStripeCustomer: vi.fn(),
}));
vi.mock("@/db/orders", () => ({
  applyInvoicePaid: vi.fn(),
  markOrderVoidedByInvoiceId: vi.fn(),
  recordOrderPaymentIntent: vi.fn(),
}));
vi.mock("@/db/refunds", () => ({ recordStripeChargeRefund: vi.fn() }));
vi.mock("@/db/refund-failures", () => ({ recordStripeRefundFailure: vi.fn() }));
vi.mock("@/db/payment-disputes", () => ({ recordStripeDispute: vi.fn() }));
vi.mock("@/db/payouts", () => ({ recordStripePayout: vi.fn(), summarizeStripePayout: vi.fn() }));
// The summary runs after the response; these cases only read what was recorded.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("@/db/stripe-restricted", () => ({
  tellOwnersPaymentsRestricted: vi.fn(),
}));
vi.mock("@/db/stripe-accounts", () => ({
  applyStripeAccountStatus: vi.fn(),
  disconnectShopStripeAccount: vi.fn(),
}));
vi.mock("@/db/webhook-events", () => ({
  claimStripeWebhookEvent: vi.fn(),
  hasNewerAccountUpdate: vi.fn(),
  releaseStripeWebhookEventClaim: vi.fn(),
}));
// The routes report only where a DSN is configured; the suite runs without one.
vi.mock("@/lib/sentry-dsn", () => ({ SENTRY_DSN: "https://key@sentry.invalid/1" }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { getDb } = await import("@/db/client");
const {
  markCheckoutPaidBySessionId,
  markCheckoutExpiredBySessionId,
  markCheckoutPaymentFailedBySessionId,
  recordCheckoutPaymentIntent,
} = await import("@/db/checkouts");
const { markTipPaidBySessionId, markTipExpiredBySessionId } = await import("@/db/tips");
const { applyInvoicePaid, markOrderVoidedByInvoiceId, recordOrderPaymentIntent } = await import(
  "@/db/orders"
);
const { recordStripeChargeRefund } = await import("@/db/refunds");
const { recordStripeRefundFailure } = await import("@/db/refund-failures");
const { recordStripeDispute } = await import("@/db/payment-disputes");
const { recordStripePayout, summarizeStripePayout } = await import("@/db/payouts");
const { after } = await import("next/server");
const { applyStripeAccountStatus, disconnectShopStripeAccount } = await import(
  "@/db/stripe-accounts"
);
const { claimStripeWebhookEvent, hasNewerAccountUpdate } = await import("@/db/webhook-events");
const { POST } = await import("./route");

const FAKE_DB = { fake: "db" };
const FAKE_CHECKOUT = { id: "checkout_1" };
const LIVE_SECRET = "whsec_live_fixture";
const TEST_SECRET = "whsec_test_fixture";

/** The connected account every fixture belongs to. */
const ACCOUNT = "acct_1Nv0FGQ9RKHgCVdK";

function signedHeader(payload: string, signingSecret: string) {
  const timestamp = Math.floor(nowMs() / 1000);
  const signature = createHmac("sha256", signingSecret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

/**
 * Deliver a fixture the way Stripe would.
 *
 * The fixtures are genuine **test-mode** payloads (`livemode: false`), so they
 * are signed with the test secret — the route cross-checks the two and refuses a
 * mismatch. That is not test scaffolding to work around; it is the security
 * property, and `signs a real test-mode event with the live secret` below drives
 * it deliberately.
 */
function deliver(name: StripeEventFixture, signingSecret = TEST_SECRET) {
  const raw = stripeEventFixtureRaw(name);
  return POST(
    new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": signedHeader(raw, signingSecret) },
      body: raw,
    }),
  );
}

beforeEach(() => {
  // A deployment that is test mode throughout: with a live secret configured
  // too, a test event is acted on only for the canonical demo (ADR
  // 20261009-demo-test-mode-payments), and these cases are about parsing.
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
  vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", TEST_SECRET);
  vi.mocked(getDb).mockResolvedValue(FAKE_DB as never);
  vi.mocked(markCheckoutPaidBySessionId)
    .mockReset()
    .mockResolvedValue(FAKE_CHECKOUT as never);
  vi.mocked(markCheckoutExpiredBySessionId)
    .mockReset()
    .mockResolvedValue(FAKE_CHECKOUT as never);
  vi.mocked(markCheckoutPaymentFailedBySessionId)
    .mockReset()
    .mockResolvedValue(FAKE_CHECKOUT as never);
  vi.mocked(applyInvoicePaid).mockReset().mockResolvedValue({ status: "not_found" });
  vi.mocked(markOrderVoidedByInvoiceId).mockReset();
  vi.mocked(recordOrderPaymentIntent).mockReset().mockResolvedValue(true);
  vi.mocked(recordCheckoutPaymentIntent).mockReset().mockResolvedValue(true);
  vi.mocked(recordStripeChargeRefund).mockReset().mockResolvedValue({ status: "already_recorded" });
  vi.mocked(recordStripeDispute).mockReset().mockResolvedValue({ status: "not_found" });
  vi.mocked(recordStripePayout).mockReset().mockResolvedValue({ status: "not_found" });
  vi.mocked(summarizeStripePayout).mockReset();
  vi.mocked(after).mockReset();
  vi.mocked(applyStripeAccountStatus)
    .mockReset()
    .mockResolvedValue({ account: null, newlyRestricted: false });
  vi.mocked(disconnectShopStripeAccount).mockReset();
  vi.mocked(markTipPaidBySessionId).mockReset();
  vi.mocked(markTipExpiredBySessionId).mockReset();
  vi.mocked(claimStripeWebhookEvent).mockReset().mockResolvedValue(true);
  vi.mocked(hasNewerAccountUpdate).mockReset().mockResolvedValue(false);
  // The route logs a structured line per delivery and per outcome. That is
  // asserted in route.test.ts; here it is only noise, and a passing run should
  // be quiet.
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.mocked(console.log).mockRestore();
});

describe("invoice events", () => {
  it("invoice.paid takes the id and amount_paid off the real Invoice object", async () => {
    expect((await deliver("invoice.paid")).status).toBe(200);
    expect(applyInvoicePaid).toHaveBeenCalledWith(FAKE_DB, {
      stripeInvoiceId: "in_1QsAVeLkdIwHu7ixKmNpQrSt",
      amountPaidCents: 24_000,
      expectedAccountId: ACCOUNT,
      taxCents: 0,
    });
  });

  it("invoice.voided voids by the same invoice id", async () => {
    expect((await deliver("invoice.voided")).status).toBe(200);
    expect(markOrderVoidedByInvoiceId).toHaveBeenCalledWith(
      FAKE_DB,
      "in_1QsAVeLkdIwHu7ixKmNpQrSt",
      ACCOUNT,
    );
  });
});

describe("checkout session events", () => {
  const SESSION_ID = "cs_test_a1H7QkLmNpRsTuVwXyZ0123456789abcdefghijklmnopqrstuvwxyzAB";

  it("checkout.session.completed settles for Stripe's discounted amount_total", async () => {
    // The real session asked 36000 and settled 32400 after a promotion code.
    // The handler must hand the *settled* figure to the split, or one party
    // member's refund later reverses money that never arrived (PAY-H1/H2).
    expect((await deliver("checkout.session.completed")).status).toBe(200);
    expect(markCheckoutPaidBySessionId).toHaveBeenCalledWith(
      FAKE_DB,
      SESSION_ID,
      ACCOUNT,
      32_400,
      0,
      { firstCompletion: false, reportedOverCeiling: false },
    );
    expect(markTipPaidBySessionId).not.toHaveBeenCalled();
  });

  it("checkout.session.completed falls back to no settled figure when Stripe sends none", async () => {
    // `amount_total` is optional/nullable in the route's schema on purpose, and
    // the fallback (record what was *asked*) is a different code path from the
    // one above. Drive it with the real payload minus that one field rather
    // than a hand-built stub, so the rest of the object stays honest.
    const raw = stripeEventFixture("checkout.session.completed");
    const session = (raw.data as { object: Record<string, unknown> }).object;
    delete session.amount_total;
    const body = JSON.stringify(raw);

    const response = await POST(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": signedHeader(body, TEST_SECRET) },
        body,
      }),
    );

    expect(response.status).toBe(200);
    // Undefined, not 0 — a zero would record a party as having paid nothing and
    // let a later cancellation reverse money that did arrive.
    expect(markCheckoutPaidBySessionId).toHaveBeenCalledWith(
      FAKE_DB,
      SESSION_ID,
      ACCOUNT,
      undefined,
      0,
      { firstCompletion: false, reportedOverCeiling: false },
    );
  });

  it("checkout.session.async_payment_succeeded settles a delayed-notification payment", async () => {
    expect((await deliver("checkout.session.async_payment_succeeded")).status).toBe(200);
    expect(markCheckoutPaidBySessionId).toHaveBeenCalledWith(
      FAKE_DB,
      SESSION_ID,
      ACCOUNT,
      36_000,
      0,
      { firstCompletion: false, reportedOverCeiling: false },
    );
  });

  it("checkout.session.async_payment_failed releases the pending state without touching money", async () => {
    expect((await deliver("checkout.session.async_payment_failed")).status).toBe(200);
    expect(markCheckoutPaymentFailedBySessionId).toHaveBeenCalledWith(FAKE_DB, SESSION_ID, ACCOUNT);
    expect(markCheckoutPaidBySessionId).not.toHaveBeenCalled();
  });

  it("checkout.session.expired expires the checkout", async () => {
    expect((await deliver("checkout.session.expired")).status).toBe(200);
    expect(markCheckoutExpiredBySessionId).toHaveBeenCalledWith(FAKE_DB, SESSION_ID, ACCOUNT);
  });
});

describe("money reversed outside DiveDay (ADR 20261009-stripe-reversals-reach-diveday)", () => {
  it("invoice.paid records the PaymentIntent off the real invoice-payments list", async () => {
    vi.mocked(applyInvoicePaid).mockResolvedValue({
      status: "settled",
      order: { id: "order_1" },
    } as never);
    await deliver("invoice.paid");
    expect(recordOrderPaymentIntent).toHaveBeenCalledWith(FAKE_DB, {
      stripeInvoiceId: "in_1QsAVeLkdIwHu7ixKmNpQrSt",
      paymentIntentId: "pi_3QsAVfLkdIwHu7ix0PqRsT1U",
      expectedAccountId: ACCOUNT,
    });
  });

  it("checkout.session.completed records the session's PaymentIntent", async () => {
    await deliver("checkout.session.completed");
    expect(recordCheckoutPaymentIntent).toHaveBeenCalledWith(FAKE_DB, {
      stripeSessionId: expect.any(String),
      paymentIntentId: "pi_3QsAVgLkdIwHu7ix1YtNqW9K",
      expectedAccountId: ACCOUNT,
    });
  });

  it("charge.refunded takes the cumulative amount_refunded and the PaymentIntent off a real Charge", async () => {
    const response = await deliver("charge.refunded");
    expect(response.status).toBe(200);
    expect(recordStripeChargeRefund).toHaveBeenCalledWith(
      FAKE_DB,
      {
        stripeAccountId: ACCOUNT,
        paymentIntentId: "pi_3QsAVgLkdIwHu7ix1YtNqW9K",
        amountRefundedCents: 12_000,
        chargeId: "ch_3QsAVgLkdIwHu7ix1ZpMrX8L",
        occurredAt: new Date(1784645400 * 1000),
      },
      expect.anything(),
    );
  });

  it("charge.refund.updated reads a failed Refund's id, amount, status and PaymentIntent (issue 2291)", async () => {
    vi.mocked(recordStripeRefundFailure).mockResolvedValue({ status: "reversed" });
    const response = await deliver("charge.refund.updated");
    expect(response.status).toBe(200);
    expect(recordStripeRefundFailure).toHaveBeenCalledWith(
      FAKE_DB,
      {
        stripeAccountId: ACCOUNT,
        paymentIntentId: "pi_3QsAVgLkdIwHu7ix1YtNqW9K",
        refund: {
          id: "re_3QsAVgLkdIwHu7ix1KpQrStU",
          amountCents: 12_000,
          currency: "usd",
          status: "failed",
          failureReason: "expired_or_canceled_card",
        },
        occurredAt: new Date(1784818200 * 1000),
      },
      expect.anything(),
    );
  });

  it("charge.dispute.created reads the amount, reason, status and evidence deadline off a real Dispute", async () => {
    await deliver("charge.dispute.created");
    expect(recordStripeDispute).toHaveBeenCalledWith(
      FAKE_DB,
      {
        stripeAccountId: ACCOUNT,
        eventType: "charge.dispute.created",
        occurredAt: new Date(1784900000 * 1000),
        dispute: {
          id: "du_1QsAVkLkdIwHu7ixDisputeA",
          paymentIntentId: "pi_3QsAVgLkdIwHu7ix1YtNqW9K",
          amountCents: 24_000,
          currency: "usd",
          reason: "fraudulent",
          status: "needs_response",
          evidenceDueBy: new Date(1785729599 * 1000),
          createdAt: new Date(1784900000 * 1000),
        },
      },
      expect.anything(),
    );
  });

  it("charge.dispute.closed carries Stripe's decision and a null deadline", async () => {
    await deliver("charge.dispute.closed");
    expect(recordStripeDispute).toHaveBeenCalledWith(
      FAKE_DB,
      expect.objectContaining({
        eventType: "charge.dispute.closed",
        dispute: expect.objectContaining({ status: "won", evidenceDueBy: null }),
      }),
      expect.anything(),
    );
  });
});

describe("payouts (ADR 20261012-payouts-reach-diveday)", () => {
  it("payout.paid reads the amount, arrival day and automatic flag off a real Payout", async () => {
    expect((await deliver("payout.paid")).status).toBe(200);
    expect(recordStripePayout).toHaveBeenCalledWith(FAKE_DB, {
      stripeAccountId: ACCOUNT,
      occurredAt: new Date(1785060000 * 1000),
      payout: {
        id: "po_1QsAVmLkdIwHu7ixPayoutA",
        amountCents: 184_200,
        currency: "usd",
        status: "paid",
        arrivalDate: new Date(1785024000 * 1000),
        automatic: true,
        failureCode: null,
      },
    });
  });

  it("payout.failed carries Stripe's failure code", async () => {
    await deliver("payout.failed");
    expect(recordStripePayout).toHaveBeenCalledWith(
      FAKE_DB,
      expect.objectContaining({
        payout: expect.objectContaining({ status: "failed", failureCode: "account_closed" }),
      }),
    );
  });
});

describe("payout.canceled", () => {
  it("records the cancelled status off a real Payout, with no failure code", async () => {
    expect((await deliver("payout.canceled")).status).toBe(200);
    expect(recordStripePayout).toHaveBeenCalledWith(
      FAKE_DB,
      expect.objectContaining({
        payout: expect.objectContaining({ status: "canceled", failureCode: null }),
      }),
    );
  });
});

describe("payout.paid summary, after the response (issue #2464)", () => {
  it("asks Stripe after answering, and a failing summary never fails the delivery", async () => {
    vi.mocked(recordStripePayout).mockResolvedValue({
      status: "recorded",
      needsSummary: true,
      payout: {} as never,
    });
    vi.mocked(summarizeStripePayout).mockRejectedValue(new Error("db down"));
    expect((await deliver("payout.paid")).status).toBe(200);
    // Nothing asked yet: the response did not wait on Stripe.
    expect(summarizeStripePayout).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledTimes(1);
    const [task] = vi.mocked(after).mock.calls[0] ?? [];
    await expect((task as () => Promise<void>)()).resolves.toBeUndefined();
    expect(summarizeStripePayout).toHaveBeenCalledWith(FAKE_DB, expect.anything(), {
      stripeAccountId: ACCOUNT,
      payoutId: "po_1QsAVmLkdIwHu7ixPayoutA",
      automatic: true,
    });
  });

  it("schedules nothing for a payout already summarized, or one that never arrived", async () => {
    vi.mocked(recordStripePayout).mockResolvedValue({
      status: "recorded",
      needsSummary: false,
      payout: {} as never,
    });
    await deliver("payout.paid");
    await deliver("payout.failed");
    expect(after).not.toHaveBeenCalled();
  });
});

describe("account events", () => {
  it("account.updated passes the real Account's own flags and currency through", async () => {
    expect((await deliver("account.updated")).status).toBe(200);
    expect(applyStripeAccountStatus).toHaveBeenCalledWith(FAKE_DB, ACCOUNT, {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      defaultCurrency: "usd",
    });
  });

  it("account.updated claims under the id the staleness query reads back", async () => {
    // Writer and reader must agree on the key or the ordering defense silently
    // degrades to last-write-wins on charges_enabled. A real event carries both
    // a top-level `account` and a body `id`; they are the same string, and this
    // is where that stays true.
    await deliver("account.updated");
    expect(claimStripeWebhookEvent).toHaveBeenCalledWith(
      FAKE_DB,
      expect.objectContaining({ account: ACCOUNT, type: "account.updated" }),
    );
    expect(hasNewerAccountUpdate).toHaveBeenCalledWith(
      FAKE_DB,
      ACCOUNT,
      "evt_1QsAVqLkdIwHu7ixAcctUpQr",
      new Date(1_784_643_000 * 1000),
    );
  });

  it("account.application.deauthorized names the account only from the envelope", async () => {
    // Stripe puts the *Application* in `data.object` for this type — the
    // connected account appears nowhere but the event's top-level `account`.
    // The fixture keeps that asymmetry, which is what makes this assertion
    // worth anything.
    const body = (
      stripeEventFixture("account.application.deauthorized").data as {
        object: Record<string, unknown>;
      }
    ).object;
    expect(body.object).toBe("application");
    expect(body.id).toMatch(/^ca_/);

    expect((await deliver("account.application.deauthorized")).status).toBe(200);
    expect(disconnectShopStripeAccount).toHaveBeenCalledWith(FAKE_DB, ACCOUNT, {
      deauthorizedAt: new Date(1_784_644_000 * 1000),
    });
  });
});

describe("the livemode cross-check, against real test-mode events", () => {
  it("signs a real test-mode event with the live secret and changes nothing", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", LIVE_SECRET);
    // Every fixture is `livemode: false`. Verified by the *live* secret, that
    // mismatch must be a quiet 200-and-ignore — never a write to live payment
    // state, and never a non-2xx that would make Stripe retry it forever.
    const response = await deliver("checkout.session.completed", LIVE_SECRET);
    expect(response.status).toBe(200);
    expect(markCheckoutPaidBySessionId).not.toHaveBeenCalled();
    expect(markTipPaidBySessionId).not.toHaveBeenCalled();
    // Refused before the ledger, so a redelivery under the right secret still works.
    expect(claimStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it("refuses a real event signed by neither secret", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", LIVE_SECRET);
    const response = await deliver("invoice.paid", "whsec_not_ours");
    expect(response.status).toBe(400);
    expect(applyInvoicePaid).not.toHaveBeenCalled();
  });
});
