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
}));

const { getDb } = await import("@/db/client");
const { markCheckoutPaidBySessionId, markCheckoutExpiredBySessionId } = await import(
  "@/db/checkouts"
);
const { markTipPaidBySessionId, markTipExpiredBySessionId } = await import("@/db/tips");
const { markOrderPaidByInvoiceId, markOrderVoidedByInvoiceId } = await import("@/db/orders");
const { setShopStripeAccountStatus, disconnectShopStripeAccount } = await import(
  "@/db/stripe-accounts"
);
const { claimStripeWebhookEvent, hasNewerAccountUpdate } = await import("@/db/webhook-events");
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
  vi.mocked(markOrderPaidByInvoiceId).mockReset();
  vi.mocked(markOrderVoidedByInvoiceId).mockReset();
  vi.mocked(setShopStripeAccountStatus).mockReset();
  vi.mocked(disconnectShopStripeAccount).mockReset();
  vi.mocked(markTipPaidBySessionId).mockReset();
  vi.mocked(markTipExpiredBySessionId).mockReset();
  vi.mocked(claimStripeWebhookEvent).mockReset().mockResolvedValue(true);
  vi.mocked(hasNewerAccountUpdate).mockReset().mockResolvedValue(false);
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
      data: { object: {} },
    });
    expect(response.status).toBe(200);
    expect(disconnectShopStripeAccount).toHaveBeenCalledWith(FAKE_DB, "acct_123");
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
