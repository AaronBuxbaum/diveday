import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nowMs } from "@/lib/clock";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/checkouts", () => ({
  markCheckoutPaidBySessionId: vi.fn(),
  markCheckoutExpiredBySessionId: vi.fn(),
  markCheckoutPaymentFailedBySessionId: vi.fn(),
}));
vi.mock("@/db/tips", () => ({
  markTipPaidBySessionId: vi.fn(),
  markTipExpiredBySessionId: vi.fn(),
}));
vi.mock("@/db/orders", () => ({
  markOrderPaidByInvoiceId: vi.fn(),
  markOrderVoidedByInvoiceId: vi.fn(),
}));
vi.mock("@/db/stripe-accounts", () => ({
  setShopStripeAccountStatus: vi.fn(),
  disconnectShopStripeAccount: vi.fn(),
}));
vi.mock("@/db/webhook-events", () => ({
  claimStripeWebhookEvent: vi.fn(),
  hasNewerAccountUpdate: vi.fn(),
  releaseStripeWebhookEventClaim: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { getDb } = await import("@/db/client");
const {
  markCheckoutPaidBySessionId,
  markCheckoutExpiredBySessionId,
  markCheckoutPaymentFailedBySessionId,
} = await import("@/db/checkouts");
const { markTipPaidBySessionId, markTipExpiredBySessionId } = await import("@/db/tips");
const { markOrderPaidByInvoiceId, markOrderVoidedByInvoiceId } = await import("@/db/orders");
const { setShopStripeAccountStatus, disconnectShopStripeAccount } = await import(
  "@/db/stripe-accounts"
);
const { claimStripeWebhookEvent, hasNewerAccountUpdate, releaseStripeWebhookEventClaim } =
  await import("@/db/webhook-events");
const Sentry = await import("@sentry/nextjs");
const { POST } = await import("./route");

const secret = "whsec_test";
const FAKE_DB = { fake: "db" };

function signedHeader(payload: string, timestamp: number, signingSecret = secret) {
  const signature = createHmac("sha256", signingSecret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function webhookRequest(payload: string, signature: string | null) {
  const headers: Record<string, string> = {};
  if (signature !== null) headers["stripe-signature"] = signature;
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers,
    body: payload,
  });
}

function eventPayload(event: Record<string, unknown>) {
  // Every test in this file signs with the "live" secret (STRIPE_WEBHOOK_SECRET)
  // unless it explicitly overrides `livemode` or signs with the test secret, so
  // default livemode:true keeps the whole suite realistic without touching
  // every call site individually.
  return JSON.stringify({ livemode: true, ...event });
}

const FAKE_CHECKOUT = { id: "checkout_1" };

beforeEach(() => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
  vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", "");
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
  vi.mocked(markOrderPaidByInvoiceId).mockReset();
  vi.mocked(markOrderVoidedByInvoiceId).mockReset();
  vi.mocked(setShopStripeAccountStatus).mockReset();
  vi.mocked(disconnectShopStripeAccount).mockReset();
  vi.mocked(markTipPaidBySessionId).mockReset();
  vi.mocked(markTipExpiredBySessionId).mockReset();
  vi.mocked(claimStripeWebhookEvent).mockReset().mockResolvedValue(true);
  vi.mocked(hasNewerAccountUpdate).mockReset().mockResolvedValue(false);
  vi.mocked(releaseStripeWebhookEventClaim).mockReset().mockResolvedValue(true);
  vi.mocked(Sentry.captureException).mockReset();
});

describe("POST /api/webhooks/stripe — fails closed on a bad signature", () => {
  it("returns 503 when no webhook secret is configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", "");
    const payload = eventPayload({ id: "evt_1", type: "invoice.paid", data: { object: {} } });
    const response = await POST(
      webhookRequest(payload, signedHeader(payload, Math.floor(nowMs() / 1000))),
    );
    expect(response.status).toBe(503);
    expect(markOrderPaidByInvoiceId).not.toHaveBeenCalled();
  });

  it("returns 400 with a missing signature header", async () => {
    const payload = eventPayload({ id: "evt_1", type: "invoice.paid", data: { object: {} } });
    const response = await POST(webhookRequest(payload, null));
    expect(response.status).toBe(400);
  });

  it("returns 400 with a signature that doesn't match the payload", async () => {
    const payload = eventPayload({ id: "evt_1", type: "invoice.paid", data: { object: {} } });
    const badHeader = signedHeader(payload, Math.floor(nowMs() / 1000), "whsec_wrong");
    const response = await POST(webhookRequest(payload, badHeader));
    expect(response.status).toBe(400);
    expect(markOrderPaidByInvoiceId).not.toHaveBeenCalled();
  });

  it("never reaches event handling before signature verification, no matter the event type", async () => {
    const payload = eventPayload({
      id: "evt_1",
      type: "account.application.deauthorized",
      account: "acct_evil",
      data: { object: {} },
    });
    const response = await POST(webhookRequest(payload, "t=1,v1=deadbeef"));
    expect(response.status).toBe(400);
    expect(disconnectShopStripeAccount).not.toHaveBeenCalled();
  });

  it("verifies and accepts requests signed by the test webhook secret when configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", "whsec_test_mode");
    const payload = eventPayload({
      id: "evt_1",
      type: "invoice.paid",
      livemode: false,
      data: { object: { id: "in_123", amount_paid: 4500 } },
    });
    const header = signedHeader(payload, Math.floor(nowMs() / 1000), "whsec_test_mode");
    const response = await POST(webhookRequest(payload, header));
    expect(response.status).toBe(200);
    expect(markOrderPaidByInvoiceId).toHaveBeenCalledWith(FAKE_DB, "in_123", 4500, undefined);
  });

  it("tries test webhook secret if live webhook secret fails, and succeeds if test secret matches", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_live_mode");
    vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", "whsec_test_mode");
    const payload = eventPayload({
      id: "evt_1",
      type: "invoice.paid",
      livemode: false,
      data: { object: { id: "in_123", amount_paid: 4500 } },
    });
    const header = signedHeader(payload, Math.floor(nowMs() / 1000), "whsec_test_mode");
    const response = await POST(webhookRequest(payload, header));
    expect(response.status).toBe(200);
    expect(markOrderPaidByInvoiceId).toHaveBeenCalledWith(FAKE_DB, "in_123", 4500, undefined);
  });

  it("ignores (200, no state change) a checkout.session.completed signed by the live secret but claiming livemode:false", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_live_mode");
    vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", "");
    const payload = eventPayload({
      id: "evt_1",
      type: "checkout.session.completed",
      livemode: false,
      data: { object: { id: "cs_123", payment_status: "paid" } },
    });
    const header = signedHeader(payload, Math.floor(nowMs() / 1000), "whsec_live_mode");
    const response = await POST(webhookRequest(payload, header));
    expect(response.status).toBe(200);
    expect(markCheckoutPaidBySessionId).not.toHaveBeenCalled();
    expect(markTipPaidBySessionId).not.toHaveBeenCalled();
    expect(claimStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it("ignores (200, no state change) a checkout.session.completed signed by the test secret but claiming livemode:true", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", "whsec_test_mode");
    const payload = eventPayload({
      id: "evt_1",
      type: "checkout.session.completed",
      livemode: true,
      data: { object: { id: "cs_123", payment_status: "paid" } },
    });
    const header = signedHeader(payload, Math.floor(nowMs() / 1000), "whsec_test_mode");
    const response = await POST(webhookRequest(payload, header));
    expect(response.status).toBe(200);
    expect(markCheckoutPaidBySessionId).not.toHaveBeenCalled();
    expect(markTipPaidBySessionId).not.toHaveBeenCalled();
    expect(claimStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it("ignores (200, no state change) an event with livemode omitted entirely", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_live_mode");
    vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", "");
    const payload = JSON.stringify({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_123", payment_status: "paid" } },
    });
    const header = signedHeader(payload, Math.floor(nowMs() / 1000), "whsec_live_mode");
    const response = await POST(webhookRequest(payload, header));
    expect(response.status).toBe(200);
    expect(markCheckoutPaidBySessionId).not.toHaveBeenCalled();
    expect(claimStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it("fails with 400 when both are configured but signature matches neither", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_live_mode");
    vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", "whsec_test_mode");
    const payload = eventPayload({
      id: "evt_1",
      type: "invoice.paid",
      data: { object: { id: "in_123", amount_paid: 4500 } },
    });
    const header = signedHeader(payload, Math.floor(nowMs() / 1000), "whsec_wrong");
    const response = await POST(webhookRequest(payload, header));
    expect(response.status).toBe(400);
    expect(markOrderPaidByInvoiceId).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/stripe — event dispatch", () => {
  function post(event: Record<string, unknown>) {
    const payload = eventPayload(event);
    const header = signedHeader(payload, Math.floor(nowMs() / 1000));
    return POST(webhookRequest(payload, header));
  }

  it("invoice.paid marks the order paid with the amount from the invoice", async () => {
    const response = await post({
      id: "evt_1",
      type: "invoice.paid",
      data: { object: { id: "in_123", amount_paid: 4500 } },
    });
    expect(response.status).toBe(200);
    expect(markOrderPaidByInvoiceId).toHaveBeenCalledWith(FAKE_DB, "in_123", 4500, undefined);
  });

  it("invoice.paid defaults amount to 0 when Stripe omits it", async () => {
    const response = await post({
      id: "evt_1",
      type: "invoice.paid",
      data: { object: { id: "in_123" } },
    });
    expect(response.status).toBe(200);
    expect(markOrderPaidByInvoiceId).toHaveBeenCalledWith(FAKE_DB, "in_123", 0, undefined);
  });

  it("invoice.voided marks the order void", async () => {
    const response = await post({
      id: "evt_1",
      type: "invoice.voided",
      data: { object: { id: "in_123" } },
    });
    expect(response.status).toBe(200);
    expect(markOrderVoidedByInvoiceId).toHaveBeenCalledWith(FAKE_DB, "in_123", undefined);
  });

  it("invoice.paid passes the event's top-level account through for the row's own cross-check", async () => {
    const response = await post({
      id: "evt_1",
      type: "invoice.paid",
      account: "acct_123",
      data: { object: { id: "in_123", amount_paid: 4500 } },
    });
    expect(response.status).toBe(200);
    expect(markOrderPaidByInvoiceId).toHaveBeenCalledWith(FAKE_DB, "in_123", 4500, "acct_123");
  });

  it("checkout.session.completed with payment_status paid marks the checkout paid", async () => {
    const response = await post({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_123", payment_status: "paid", amount_total: 36_000 } },
    });
    expect(response.status).toBe(200);
    // Stripe's own settled total travels with the event and is handed to the
    // completion, which splits it across the bookings it paid for (PAY-H1/H2).
    expect(markCheckoutPaidBySessionId).toHaveBeenCalledWith(FAKE_DB, "cs_123", undefined, 36_000);
    // A session id belongs to at most one of booking_checkouts or tips —
    // the booking-checkout path found a match, so the tip fallback never runs.
    expect(markTipPaidBySessionId).not.toHaveBeenCalled();
  });

  it("checkout.session.completed falls back to marking a tip paid when no booking checkout matches the session", async () => {
    vi.mocked(markCheckoutPaidBySessionId).mockResolvedValue(null);
    const response = await post({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_tip_1", payment_status: "paid" } },
    });
    expect(response.status).toBe(200);
    expect(markTipPaidBySessionId).toHaveBeenCalledWith(FAKE_DB, "cs_tip_1", undefined);
  });

  it("checkout.session.completed does NOT mark paid when payment_status is unpaid (async payment pending)", async () => {
    const response = await post({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_123", payment_status: "unpaid" } },
    });
    expect(response.status).toBe(200);
    expect(markCheckoutPaidBySessionId).not.toHaveBeenCalled();
  });

  it("checkout.session.async_payment_succeeded marks the checkout paid regardless of payment_status field", async () => {
    const response = await post({
      id: "evt_1",
      type: "checkout.session.async_payment_succeeded",
      data: { object: { id: "cs_123" } },
    });
    expect(response.status).toBe(200);
    // No amount_total on this payload: none is invented, and the completion
    // falls back to the amounts DiveDay asked for.
    expect(markCheckoutPaidBySessionId).toHaveBeenCalledWith(
      FAKE_DB,
      "cs_123",
      undefined,
      undefined,
    );
    expect(markTipPaidBySessionId).not.toHaveBeenCalled();
  });

  // PAY-L1. Previously this event fell through to `unhandled_event_type`,
  // leaving a delayed-notification payment's checkout `pending` forever.
  it("checkout.session.async_payment_failed releases the checkout's pending state", async () => {
    const response = await post({
      id: "evt_1",
      type: "checkout.session.async_payment_failed",
      account: "acct_shop",
      data: { object: { id: "cs_123" } },
    });
    expect(response.status).toBe(200);
    expect(markCheckoutPaymentFailedBySessionId).toHaveBeenCalledWith(
      FAKE_DB,
      "cs_123",
      "acct_shop",
    );
    // Never a payment-side write, and never the paid path.
    expect(markCheckoutPaidBySessionId).not.toHaveBeenCalled();
    expect(markTipExpiredBySessionId).not.toHaveBeenCalled();
  });

  it("checkout.session.async_payment_failed falls back to the tip table on the shared session-id space", async () => {
    vi.mocked(markCheckoutPaymentFailedBySessionId).mockResolvedValue(null);
    const response = await post({
      id: "evt_1",
      type: "checkout.session.async_payment_failed",
      data: { object: { id: "cs_tip_1" } },
    });
    expect(response.status).toBe(200);
    expect(markTipExpiredBySessionId).toHaveBeenCalledWith(FAKE_DB, "cs_tip_1", undefined);
  });

  // Idempotency at the route level: the db helper returns null for a row that
  // is no longer `pending` (already failed, already completed, already
  // expired). The route must answer 200 and change nothing else — a non-2xx
  // would make Stripe retry a genuinely-handled event forever.
  it("checkout.session.async_payment_failed is a quiet 200 when nothing is left to release", async () => {
    vi.mocked(markCheckoutPaymentFailedBySessionId).mockResolvedValue(null);
    vi.mocked(markTipExpiredBySessionId).mockResolvedValue(null as never);
    const response = await post({
      id: "evt_replay",
      type: "checkout.session.async_payment_failed",
      data: { object: { id: "cs_already_settled" } },
    });
    expect(response.status).toBe(200);
    expect(markCheckoutPaidBySessionId).not.toHaveBeenCalled();
    expect(releaseStripeWebhookEventClaim).not.toHaveBeenCalled();
  });

  it("checkout.session.async_payment_failed ignores a malformed payload", async () => {
    const response = await post({
      id: "evt_1",
      type: "checkout.session.async_payment_failed",
      data: { object: {} },
    });
    expect(response.status).toBe(200);
    expect(markCheckoutPaymentFailedBySessionId).not.toHaveBeenCalled();
    expect(markTipExpiredBySessionId).not.toHaveBeenCalled();
  });

  it("checkout.session.expired marks the checkout expired", async () => {
    const response = await post({
      id: "evt_1",
      type: "checkout.session.expired",
      data: { object: { id: "cs_123" } },
    });
    expect(response.status).toBe(200);
    expect(markCheckoutExpiredBySessionId).toHaveBeenCalledWith(FAKE_DB, "cs_123", undefined);
    expect(markTipExpiredBySessionId).not.toHaveBeenCalled();
  });

  it("checkout.session.expired falls back to marking a tip expired when no booking checkout matches the session", async () => {
    vi.mocked(markCheckoutExpiredBySessionId).mockResolvedValue(null);
    const response = await post({
      id: "evt_1",
      type: "checkout.session.expired",
      data: { object: { id: "cs_tip_1" } },
    });
    expect(response.status).toBe(200);
    expect(markTipExpiredBySessionId).toHaveBeenCalledWith(FAKE_DB, "cs_tip_1", undefined);
  });

  it("account.updated sets the shop's charges/payouts/details status", async () => {
    const response = await post({
      id: "evt_1",
      type: "account.updated",
      data: {
        object: {
          id: "acct_123",
          charges_enabled: true,
          payouts_enabled: false,
          details_submitted: true,
        },
      },
    });
    expect(response.status).toBe(200);
    expect(setShopStripeAccountStatus).toHaveBeenCalledWith(FAKE_DB, "acct_123", {
      chargesEnabled: true,
      payoutsEnabled: false,
      detailsSubmitted: true,
    });
  });

  it("account.updated passes the account's own currency through, not a hardcoded usd (task 60)", async () => {
    const response = await post({
      id: "evt_2",
      type: "account.updated",
      data: {
        object: {
          id: "acct_123",
          charges_enabled: true,
          payouts_enabled: false,
          details_submitted: true,
          default_currency: "eur",
        },
      },
    });
    expect(response.status).toBe(200);
    expect(setShopStripeAccountStatus).toHaveBeenCalledWith(FAKE_DB, "acct_123", {
      chargesEnabled: true,
      payoutsEnabled: false,
      detailsSubmitted: true,
      defaultCurrency: "eur",
    });
  });

  it("account.application.deauthorized disconnects the shop's account by the event's top-level account field", async () => {
    const response = await post({
      id: "evt_1",
      type: "account.application.deauthorized",
      account: "acct_123",
      created: 1_700_000_000,
      data: { object: {} },
    });
    expect(response.status).toBe(200);
    // Ordered against Stripe's own creation time, so a redelivery landing after
    // the owner has reconnected cannot cut a live account off (PAY-M1's second
    // half: the claim really is released and this handler really is re-reached).
    expect(disconnectShopStripeAccount).toHaveBeenCalledWith(FAKE_DB, "acct_123", {
      deauthorizedAt: new Date(1_700_000_000 * 1000),
    });
  });

  it("account.application.deauthorized is a quiet 200 when the shop has since reconnected", async () => {
    // The db call refuses a deauthorization older than the connection it names
    // and hands back the still-connected row; the route must read that as a
    // handled no-op, not as a failure Stripe should retry.
    vi.mocked(disconnectShopStripeAccount).mockResolvedValue({
      stripeAccountId: "acct_123",
      disconnectedAt: null,
    } as never);
    const response = await post({
      id: "evt_stale_deauth",
      type: "account.application.deauthorized",
      account: "acct_123",
      created: 1_700_000_000,
      data: { object: {} },
    });
    expect(response.status).toBe(200);
  });

  it("account.application.deauthorized does nothing if the event has no account field", async () => {
    const response = await post({
      id: "evt_1",
      type: "account.application.deauthorized",
      data: { object: {} },
    });
    expect(response.status).toBe(200);
    expect(disconnectShopStripeAccount).not.toHaveBeenCalled();
  });

  it("an unhandled event type is a no-op 200, not an error", async () => {
    const response = await post({
      id: "evt_1",
      type: "invoice.payment_failed",
      data: { object: { id: "in_123" } },
    });
    expect(response.status).toBe(200);
    expect(markOrderPaidByInvoiceId).not.toHaveBeenCalled();
    expect(markOrderVoidedByInvoiceId).not.toHaveBeenCalled();
  });

  it("a malformed event object for the type is silently skipped rather than throwing", async () => {
    const response = await post({
      id: "evt_1",
      type: "invoice.paid",
      data: { object: { amount_paid: "not-a-number-and-no-id" } },
    });
    expect(response.status).toBe(200);
    expect(markOrderPaidByInvoiceId).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/stripe — event ledger", () => {
  function post(event: Record<string, unknown>) {
    const payload = eventPayload(event);
    const header = signedHeader(payload, Math.floor(nowMs() / 1000));
    return POST(webhookRequest(payload, header));
  }

  it("claims every verified event before dispatching to a handler", async () => {
    const response = await post({
      id: "evt_claim_1",
      type: "invoice.paid",
      account: "acct_123",
      created: 1_700_000_000,
      data: { object: { id: "in_123", amount_paid: 4500 } },
    });
    expect(response.status).toBe(200);
    expect(claimStripeWebhookEvent).toHaveBeenCalledWith(FAKE_DB, {
      id: "evt_claim_1",
      type: "invoice.paid",
      account: "acct_123",
      occurredAt: new Date(1_700_000_000 * 1000),
    });
    expect(markOrderPaidByInvoiceId).toHaveBeenCalled();
  });

  // The ledger's whole job: a redelivered event (Stripe is at-least-once)
  // must not reach any handler a second time, no matter what the handler's
  // own state has since become — e.g. mark a checkout paid, then a human
  // refunds it; the same event delivered again must not re-run the paid
  // cascade and undo the refund.
  it("a second delivery of the same event id performs no handler dispatch", async () => {
    vi.mocked(claimStripeWebhookEvent).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const event = {
      id: "evt_replay_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_123", payment_status: "paid" } },
    };

    const first = await post(event);
    expect(first.status).toBe(200);
    expect(markCheckoutPaidBySessionId).toHaveBeenCalledTimes(1);

    const replayed = await post(event);
    expect(replayed.status).toBe(200);
    // Still just the one call from the first delivery — the replay never
    // reached the handler at all.
    expect(markCheckoutPaidBySessionId).toHaveBeenCalledTimes(1);
    // …and nothing released the claim, because nothing failed. A successful
    // handle keeps its claim forever (PAY-M1).
    expect(releaseStripeWebhookEventClaim).not.toHaveBeenCalled();
  });

  it("falls back to the local clock when a fixture event has no created timestamp", async () => {
    const response = await post({
      id: "evt_no_created",
      type: "invoice.paid",
      data: { object: { id: "in_123", amount_paid: 4500 } },
    });
    expect(response.status).toBe(200);
    expect(claimStripeWebhookEvent).toHaveBeenCalledWith(
      FAKE_DB,
      expect.objectContaining({ id: "evt_no_created", occurredAt: expect.any(Date) }),
    );
  });

  it("refuses a stale account.updated once the ledger says a newer one already landed", async () => {
    vi.mocked(hasNewerAccountUpdate).mockResolvedValue(true);
    const response = await post({
      id: "evt_stale",
      type: "account.updated",
      created: 1_700_000_000,
      data: {
        object: {
          id: "acct_123",
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
        },
      },
    });
    expect(response.status).toBe(200);
    expect(hasNewerAccountUpdate).toHaveBeenCalledWith(
      FAKE_DB,
      "acct_123",
      "evt_stale",
      new Date(1_700_000_000 * 1000),
    );
    expect(setShopStripeAccountStatus).not.toHaveBeenCalled();
  });

  it("applies an account.updated when the ledger has nothing newer for that account", async () => {
    vi.mocked(hasNewerAccountUpdate).mockResolvedValue(false);
    const response = await post({
      id: "evt_fresh",
      type: "account.updated",
      created: 1_700_000_100,
      data: {
        object: {
          id: "acct_123",
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
        },
      },
    });
    expect(response.status).toBe(200);
    expect(setShopStripeAccountStatus).toHaveBeenCalledWith(FAKE_DB, "acct_123", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
  });

  /**
   * **The staleness defense only works if writer and reader agree on the key**
   * (security review finding).
   *
   * `hasNewerAccountUpdate` filters `stripe_webhook_events.account` against the
   * id it is *given* — and every caller gives it `event.data.object.id`. The
   * claim, meanwhile, stored `event.account ?? null`. For an ordinary Connect
   * delivery those are the same string and nothing shows. Should Stripe ever
   * deliver an `account.updated` without a top-level `account`, every such row
   * would land as `null`, the query would match nothing, and the whole ordering
   * check would degrade — silently — to the last-write-wins on `charges_enabled`
   * that a previous security pass closed. No existing test caught it: they all
   * omit the top-level field and only assert what the *handler* did with the
   * body.
   */
  describe("the account.updated ledger key", () => {
    const bodyOnlyEvent = {
      id: "evt_no_top_level_account",
      type: "account.updated",
      created: 1_700_000_200,
      data: {
        object: {
          id: "acct_from_body",
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
        },
      },
    };

    it("claims under the id the staleness query reads back, with no top-level account", async () => {
      const response = await post(bodyOnlyEvent);
      expect(response.status).toBe(200);
      expect(claimStripeWebhookEvent).toHaveBeenCalledWith(
        FAKE_DB,
        expect.objectContaining({ id: "evt_no_top_level_account", account: "acct_from_body" }),
      );
      // Same id on both sides — that agreement *is* the defense.
      expect(hasNewerAccountUpdate).toHaveBeenCalledWith(
        FAKE_DB,
        "acct_from_body",
        "evt_no_top_level_account",
        new Date(1_700_000_200 * 1000),
      );
    });

    it("still prefers the top-level account when Stripe sends one", async () => {
      const response = await post({
        ...bodyOnlyEvent,
        id: "evt_top_level_account",
        account: "acct_top_level",
      });
      expect(response.status).toBe(200);
      expect(claimStripeWebhookEvent).toHaveBeenCalledWith(
        FAKE_DB,
        expect.objectContaining({ account: "acct_top_level" }),
      );
    });

    it("leaves a non-account event's ledger key alone", async () => {
      const response = await post({
        id: "evt_invoice_no_account",
        type: "invoice.paid",
        data: { object: { id: "in_123", amount_paid: 4500 } },
      });
      expect(response.status).toBe(200);
      expect(claimStripeWebhookEvent).toHaveBeenCalledWith(
        FAKE_DB,
        expect.objectContaining({ account: null }),
      );
    });

    /** A malformed body has no id to fall back to; the claim must still happen. */
    it("claims a malformed account.updated rather than throwing", async () => {
      const response = await post({
        id: "evt_malformed_account",
        type: "account.updated",
        data: { object: { charges_enabled: true } },
      });
      expect(response.status).toBe(200);
      expect(claimStripeWebhookEvent).toHaveBeenCalledWith(
        FAKE_DB,
        expect.objectContaining({ account: null }),
      );
      expect(setShopStripeAccountStatus).not.toHaveBeenCalled();
    });
  });
});

describe("POST /api/webhooks/stripe — structured logging", () => {
  function post(event: Record<string, unknown>) {
    const payload = eventPayload(event);
    const header = signedHeader(payload, Math.floor(nowMs() / 1000));
    return POST(webhookRequest(payload, header));
  }

  function loggedLines(calls: unknown[][]) {
    return calls.map((call) => JSON.parse(call[0] as string));
  }

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.warn).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  it("logs the event id/type/account and the handler's outcome for a handled event", async () => {
    await post({
      id: "evt_log_1",
      type: "invoice.paid",
      account: "acct_123",
      data: { object: { id: "in_123", amount_paid: 4500 } },
    });

    const lines = loggedLines(vi.mocked(console.log).mock.calls);
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: "stripe_webhook.event_received",
        eventId: "evt_log_1",
        eventType: "invoice.paid",
        account: "acct_123",
      }),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: "stripe_webhook.handler_outcome",
        eventId: "evt_log_1",
        outcome: "order_not_found",
      }),
    );
  });

  it("logs a null/refused handler outcome rather than vanishing silently", async () => {
    vi.mocked(markCheckoutPaidBySessionId).mockResolvedValue(null);
    await post({
      id: "evt_log_2",
      type: "checkout.session.completed",
      data: { object: { id: "cs_unknown", payment_status: "paid" } },
    });

    const lines = loggedLines(vi.mocked(console.log).mock.calls);
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: "stripe_webhook.handler_outcome",
        eventId: "evt_log_2",
        outcome: "session_not_found",
      }),
    );
  });

  it("logs a duplicate-event outcome without dispatching to a handler", async () => {
    vi.mocked(claimStripeWebhookEvent).mockResolvedValue(false);
    await post({
      id: "evt_log_dup",
      type: "invoice.paid",
      data: { object: { id: "in_123" } },
    });

    const lines = loggedLines(vi.mocked(console.log).mock.calls);
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: "stripe_webhook.handler_outcome",
        eventId: "evt_log_dup",
        outcome: "duplicate_event",
      }),
    );
  });
});

// PAY-M1: the claim is committed independently of the handler, so before this
// a throw anywhere in the dispatch left the row behind. Stripe redelivered, the
// claim said "already seen", the route answered 200, and Stripe marked the
// event delivered having never handled it — for invoice.paid, invoice.voided
// and account.application.deauthorized there is no other self-heal, so the
// order simply never went paid. Every arm below therefore has to give the claim
// back and answer non-2xx so Stripe actually retries.
describe("POST /api/webhooks/stripe — a failed handle releases its claim", () => {
  function post(event: Record<string, unknown>) {
    const payload = eventPayload(event);
    const header = signedHeader(payload, Math.floor(nowMs() / 1000));
    return POST(webhookRequest(payload, header));
  }

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  const boom = new Error("db is down");

  /** Every dispatch arm, with the db call that can throw inside it. */
  const arms: Array<{
    name: string;
    event: Record<string, unknown>;
    arrange: () => void;
  }> = [
    {
      name: "invoice.paid",
      event: { id: "evt_fail_paid", type: "invoice.paid", data: { object: { id: "in_1" } } },
      arrange: () => vi.mocked(markOrderPaidByInvoiceId).mockRejectedValue(boom),
    },
    {
      name: "invoice.voided",
      event: { id: "evt_fail_void", type: "invoice.voided", data: { object: { id: "in_1" } } },
      arrange: () => vi.mocked(markOrderVoidedByInvoiceId).mockRejectedValue(boom),
    },
    {
      name: "checkout.session.completed",
      event: {
        id: "evt_fail_checkout",
        type: "checkout.session.completed",
        data: { object: { id: "cs_1", payment_status: "paid" } },
      },
      arrange: () => vi.mocked(markCheckoutPaidBySessionId).mockRejectedValue(boom),
    },
    {
      name: "checkout.session.completed (tip fallback)",
      event: {
        id: "evt_fail_tip",
        type: "checkout.session.completed",
        data: { object: { id: "cs_tip", payment_status: "paid" } },
      },
      arrange: () => {
        vi.mocked(markCheckoutPaidBySessionId).mockResolvedValue(null);
        vi.mocked(markTipPaidBySessionId).mockRejectedValue(boom);
      },
    },
    {
      name: "checkout.session.async_payment_succeeded",
      event: {
        id: "evt_fail_async",
        type: "checkout.session.async_payment_succeeded",
        data: { object: { id: "cs_1" } },
      },
      arrange: () => vi.mocked(markCheckoutPaidBySessionId).mockRejectedValue(boom),
    },
    {
      name: "checkout.session.async_payment_failed",
      event: {
        id: "evt_fail_async_failed",
        type: "checkout.session.async_payment_failed",
        data: { object: { id: "cs_1" } },
      },
      arrange: () => vi.mocked(markCheckoutPaymentFailedBySessionId).mockRejectedValue(boom),
    },
    {
      name: "checkout.session.expired",
      event: {
        id: "evt_fail_expired",
        type: "checkout.session.expired",
        data: { object: { id: "cs_1" } },
      },
      arrange: () => vi.mocked(markCheckoutExpiredBySessionId).mockRejectedValue(boom),
    },
    {
      name: "checkout.session.expired (tip fallback)",
      event: {
        id: "evt_fail_tip_expired",
        type: "checkout.session.expired",
        data: { object: { id: "cs_tip" } },
      },
      arrange: () => {
        vi.mocked(markCheckoutExpiredBySessionId).mockResolvedValue(null);
        vi.mocked(markTipExpiredBySessionId).mockRejectedValue(boom);
      },
    },
    {
      name: "account.updated (staleness check)",
      event: {
        id: "evt_fail_stale",
        type: "account.updated",
        data: {
          object: {
            id: "acct_1",
            charges_enabled: true,
            payouts_enabled: true,
            details_submitted: true,
          },
        },
      },
      arrange: () => vi.mocked(hasNewerAccountUpdate).mockRejectedValue(boom),
    },
    {
      name: "account.updated (status write)",
      event: {
        id: "evt_fail_account",
        type: "account.updated",
        data: {
          object: {
            id: "acct_1",
            charges_enabled: true,
            payouts_enabled: true,
            details_submitted: true,
          },
        },
      },
      arrange: () => vi.mocked(setShopStripeAccountStatus).mockRejectedValue(boom),
    },
    {
      name: "account.application.deauthorized",
      event: {
        id: "evt_fail_deauth",
        type: "account.application.deauthorized",
        account: "acct_1",
        data: { object: {} },
      },
      arrange: () => vi.mocked(disconnectShopStripeAccount).mockRejectedValue(boom),
    },
  ];

  for (const arm of arms) {
    it(`${arm.name} answers 5xx and releases the claim when its handler throws`, async () => {
      arm.arrange();
      const response = await post(arm.event);

      // Non-2xx, or Stripe treats this delivery as done and never retries.
      expect(response.status).toBe(500);
      expect(releaseStripeWebhookEventClaim).toHaveBeenCalledWith(FAKE_DB, arm.event.id);
      // The original error, not a replacement, is what an operator sees.
      expect(Sentry.captureException).toHaveBeenCalledWith(boom, expect.anything());
    });
  }

  it("re-runs the handler and advances state on the redelivery after a failure", async () => {
    const event = {
      id: "evt_retry_1",
      type: "invoice.paid",
      data: { object: { id: "in_retry", amount_paid: 4500 } },
    };
    // First delivery: the order write throws.
    vi.mocked(markOrderPaidByInvoiceId)
      .mockRejectedValueOnce(boom)
      .mockResolvedValue({
        id: "order_1",
      } as never);
    const failed = await post(event);
    expect(failed.status).toBe(500);
    expect(releaseStripeWebhookEventClaim).toHaveBeenCalledWith(FAKE_DB, "evt_retry_1");

    // Stripe retries. The claim was released, so the ledger claims it afresh
    // and the handler actually runs — this is the whole point: without the
    // release the retry reads as a duplicate and the order never goes paid.
    const retried = await post(event);
    expect(retried.status).toBe(200);
    expect(markOrderPaidByInvoiceId).toHaveBeenCalledTimes(2);
    expect(markOrderPaidByInvoiceId).toHaveBeenLastCalledWith(FAKE_DB, "in_retry", 4500, undefined);
  });

  it("still does not re-run a handler on the redelivery after a success", async () => {
    // The invariant release-on-failure must not weaken (webhook-events.test.ts):
    // a handled event keeps its claim, so a manual refund made between two
    // deliveries survives the replay.
    vi.mocked(claimStripeWebhookEvent).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const event = {
      id: "evt_success_replay",
      type: "checkout.session.completed",
      data: { object: { id: "cs_ok", payment_status: "paid" } },
    };

    expect((await post(event)).status).toBe(200);
    expect((await post(event)).status).toBe(200);
    expect(markCheckoutPaidBySessionId).toHaveBeenCalledTimes(1);
    expect(releaseStripeWebhookEventClaim).not.toHaveBeenCalled();
  });

  it("a release that itself fails never masks the original error", async () => {
    const releaseBoom = new Error("release failed too");
    vi.mocked(markOrderPaidByInvoiceId).mockRejectedValue(boom);
    vi.mocked(releaseStripeWebhookEventClaim).mockRejectedValue(releaseBoom);

    const response = await post({
      id: "evt_release_boom",
      type: "invoice.paid",
      data: { object: { id: "in_1" } },
    });

    // Still a retry-triggering 5xx, and both failures are reported — the
    // handler's own error above all, since a swallowed release error would
    // otherwise be the only thing anyone saw.
    expect(response.status).toBe(500);
    expect(Sentry.captureException).toHaveBeenCalledWith(boom, expect.anything());
    expect(Sentry.captureException).toHaveBeenCalledWith(releaseBoom, expect.anything());
  });

  it("never releases a claim it never took (a duplicate is not a failure)", async () => {
    vi.mocked(claimStripeWebhookEvent).mockResolvedValue(false);
    vi.mocked(markOrderPaidByInvoiceId).mockRejectedValue(boom);

    const response = await post({
      id: "evt_dup_no_release",
      type: "invoice.paid",
      data: { object: { id: "in_1" } },
    });

    expect(response.status).toBe(200);
    expect(markOrderPaidByInvoiceId).not.toHaveBeenCalled();
    expect(releaseStripeWebhookEventClaim).not.toHaveBeenCalled();
  });
});
