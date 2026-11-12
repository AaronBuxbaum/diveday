import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nowMs } from "@/lib/clock";

/**
 * What the webhook does when Stripe reports a booking checkout paid: hand the
 * settled figure to the completion, and (#2566) tell a group's lead the total
 * exactly once. Dispatch only, every handler mocked; the sibling
 * `route.test.ts` covers the rest of the route, and
 * `src/features/party-payment-receipt/store.test.ts` covers the receipt itself.
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
vi.mock("../../../../features/party-payment-receipt/store", () => ({
  sendPartyPaymentReceipt: vi.fn(),
}));
vi.mock("../../../../features/webhook-events/store", () => ({
  claimStripeWebhookEvent: vi.fn(),
  hasNewerAccountUpdate: vi.fn(),
  releaseStripeWebhookEventClaim: vi.fn(),
}));
vi.mock("../../../../features/sentry-dsn/rules", () => ({
  SENTRY_DSN: "https://key@sentry.invalid/1",
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { getDb } = await import("@/db/client");
const { markCheckoutPaidBySessionId, recordCheckoutPaymentIntent, recordCheckoutStripeCustomer } =
  await import("@/db/checkouts");
const { sendPartyPaymentReceipt } = await import(
  "../../../../features/party-payment-receipt/store"
);
const { claimStripeWebhookEvent, hasNewerAccountUpdate, releaseStripeWebhookEventClaim } =
  await import("../../../../features/webhook-events/store");
const { POST } = await import("./route");

const secret = "whsec_test";
const FAKE_DB = { fake: "db" };
const FAKE_CHECKOUT = { id: "checkout_1", purpose: "fare" };

function post(event: Record<string, unknown>) {
  const payload = JSON.stringify({ livemode: true, ...event });
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

/** The mocked completion reports itself as the call that completed the checkout. */
function completesNow() {
  vi.mocked(markCheckoutPaidBySessionId).mockImplementation(
    async (_db, _id, _account, _total, _tax, outcome) => {
      if (outcome) outcome.firstCompletion = true;
      return FAKE_CHECKOUT as never;
    },
  );
}

const paid = {
  id: "evt_1",
  type: "checkout.session.completed",
  data: {
    object: { id: "cs_123", payment_status: "paid", amount_total: 36_000, currency: "usd" },
  },
};

beforeEach(() => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
  vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", "");
  vi.mocked(getDb).mockResolvedValue(FAKE_DB as never);
  vi.mocked(markCheckoutPaidBySessionId)
    .mockReset()
    .mockResolvedValue(FAKE_CHECKOUT as never);
  vi.mocked(sendPartyPaymentReceipt).mockReset().mockResolvedValue("sent");
  vi.mocked(recordCheckoutStripeCustomer).mockReset().mockResolvedValue(true);
  vi.mocked(recordCheckoutPaymentIntent).mockReset().mockResolvedValue(true);
  vi.mocked(claimStripeWebhookEvent).mockReset().mockResolvedValue(true);
  vi.mocked(hasNewerAccountUpdate).mockReset().mockResolvedValue(false);
  vi.mocked(releaseStripeWebhookEventClaim).mockReset().mockResolvedValue(true);
});

describe("a paid booking checkout", () => {
  it("hands Stripe's settled total to the completion", async () => {
    expect((await post(paid)).status).toBe(200);
    expect(markCheckoutPaidBySessionId).toHaveBeenCalledWith(
      FAKE_DB,
      "cs_123",
      undefined,
      36_000,
      undefined,
      { firstCompletion: false, reportedOverCeiling: false },
    );
  });

  it("invents no total when the delayed-payment event carries none", async () => {
    const response = await post({
      id: "evt_1",
      type: "checkout.session.async_payment_succeeded",
      data: { object: { id: "cs_123" } },
    });
    expect(response.status).toBe(200);
    expect(markCheckoutPaidBySessionId).toHaveBeenCalledWith(
      FAKE_DB,
      "cs_123",
      undefined,
      undefined,
      undefined,
      { firstCompletion: false, reportedOverCeiling: false },
    );
  });
});

describe("the party receipt (issue 2566)", () => {
  it("is sent once, on the delivery that completes the checkout", async () => {
    completesNow();
    expect((await post(paid)).status).toBe(200);
    expect(sendPartyPaymentReceipt).toHaveBeenCalledTimes(1);
    expect(sendPartyPaymentReceipt).toHaveBeenCalledWith(FAKE_DB, FAKE_CHECKOUT, {
      currency: "usd",
      overCeiling: false,
    });
  });

  it("hands over the session's own currency, none when Stripe sent none, and Stripe's over-ceiling total", async () => {
    vi.mocked(markCheckoutPaidBySessionId).mockImplementation(
      async (_db, _id, _account, _total, _tax, outcome) => {
        if (outcome) {
          outcome.firstCompletion = true;
          outcome.reportedOverCeiling = true;
        }
        return FAKE_CHECKOUT as never;
      },
    );
    await post({ ...paid, data: { object: { id: "cs_123", payment_status: "paid" } } });
    expect(sendPartyPaymentReceipt).toHaveBeenCalledWith(FAKE_DB, FAKE_CHECKOUT, {
      currency: null,
      overCeiling: true,
    });
  });

  it("is not sent when the checkout was already completed (a replay or a fresh-id redelivery)", async () => {
    expect((await post(paid)).status).toBe(200);
    expect(markCheckoutPaidBySessionId).toHaveBeenCalledTimes(1);
    expect(sendPartyPaymentReceipt).not.toHaveBeenCalled();
  });

  it("is not sent when no checkout matched the session", async () => {
    vi.mocked(markCheckoutPaidBySessionId).mockResolvedValue(null);
    expect((await post(paid)).status).toBe(200);
    expect(sendPartyPaymentReceipt).not.toHaveBeenCalled();
  });

  it("is never sent for a tip, even one reported as a first completion (issue #2718)", async () => {
    vi.mocked(markCheckoutPaidBySessionId).mockImplementation(
      async (_db, _id, _account, _total, _tax, outcome) => {
        if (outcome) outcome.firstCompletion = true;
        return { ...FAKE_CHECKOUT, purpose: "tip" } as never;
      },
    );
    expect((await post(paid)).status).toBe(200);
    expect(sendPartyPaymentReceipt).not.toHaveBeenCalled();
  });

  it("also follows a delayed-notification payment that settles", async () => {
    completesNow();
    const response = await post({
      id: "evt_2",
      type: "checkout.session.async_payment_succeeded",
      data: { object: { id: "cs_123" } },
    });
    expect(response.status).toBe(200);
    expect(sendPartyPaymentReceipt).toHaveBeenCalledTimes(1);
  });
});

// A 100% code, or a fixed amount at or above the total, is a Stripe no-cost
// order: no card, no PaymentIntent, a complete session with a zero total.
describe("a no-cost booking checkout", () => {
  const noCost = (object: Record<string, unknown>) => ({
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_123",
        status: "complete",
        payment_status: "no_payment_required",
        payment_intent: null,
        ...object,
      },
    },
  });

  it("settles at zero", async () => {
    expect((await post(noCost({ amount_total: 0 }))).status).toBe(200);
    expect(markCheckoutPaidBySessionId).toHaveBeenCalledWith(
      FAKE_DB,
      "cs_123",
      undefined,
      0,
      undefined,
      {
        firstCompletion: false,
        reportedOverCeiling: false,
      },
    );
  });

  it("settles nothing beside a non-zero or missing total, or an open session", async () => {
    for (const object of [
      { amount_total: 18_000 },
      { amount_total: null },
      {},
      { amount_total: 0, status: "open" },
    ]) {
      expect((await post(noCost(object))).status).toBe(200);
    }
    expect(markCheckoutPaidBySessionId).not.toHaveBeenCalled();
  });
});
