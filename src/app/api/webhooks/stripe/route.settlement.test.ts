import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nowMs } from "@/lib/clock";

/**
 * What the webhook does when Stripe reports a booking checkout paid: hand the
 * settled figure to the completion, and (#2566) tell a group's lead the total
 * exactly once. Dispatch only, every handler mocked; the sibling
 * `route.test.ts` covers the rest of the route, and
 * `src/db/party-payment-receipt.test.ts` covers the receipt itself.
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
vi.mock("@/db/party-payment-receipt", () => ({ sendPartyPaymentReceipt: vi.fn() }));
vi.mock("@/db/tips", () => ({
  markTipPaidBySessionId: vi.fn(),
  markTipExpiredBySessionId: vi.fn(),
  recordTipStripeCustomer: vi.fn(),
}));
vi.mock("@/db/webhook-events", () => ({
  claimStripeWebhookEvent: vi.fn(),
  hasNewerAccountUpdate: vi.fn(),
  releaseStripeWebhookEventClaim: vi.fn(),
}));
vi.mock("@/lib/sentry-dsn", () => ({ SENTRY_DSN: "https://key@sentry.invalid/1" }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { getDb } = await import("@/db/client");
const { markCheckoutPaidBySessionId, recordCheckoutPaymentIntent, recordCheckoutStripeCustomer } =
  await import("@/db/checkouts");
const { sendPartyPaymentReceipt } = await import("@/db/party-payment-receipt");
const { markTipPaidBySessionId } = await import("@/db/tips");
const { claimStripeWebhookEvent, hasNewerAccountUpdate, releaseStripeWebhookEventClaim } =
  await import("@/db/webhook-events");
const { POST } = await import("./route");

const secret = "whsec_test";
const FAKE_DB = { fake: "db" };
const FAKE_CHECKOUT = { id: "checkout_1" };

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
  vi.mocked(markTipPaidBySessionId).mockReset();
  vi.mocked(sendPartyPaymentReceipt).mockReset().mockResolvedValue("sent");
  vi.mocked(recordCheckoutStripeCustomer).mockReset().mockResolvedValue(true);
  vi.mocked(recordCheckoutPaymentIntent).mockReset().mockResolvedValue(true);
  vi.mocked(claimStripeWebhookEvent).mockReset().mockResolvedValue(true);
  vi.mocked(hasNewerAccountUpdate).mockReset().mockResolvedValue(false);
  vi.mocked(releaseStripeWebhookEventClaim).mockReset().mockResolvedValue(true);
});

describe("a paid booking checkout", () => {
  it("hands Stripe's settled total to the completion, and the tip fallback never runs", async () => {
    expect((await post(paid)).status).toBe(200);
    expect(markCheckoutPaidBySessionId).toHaveBeenCalledWith(
      FAKE_DB,
      "cs_123",
      undefined,
      36_000,
      undefined,
      { firstCompletion: false, reportedOverCeiling: false },
    );
    expect(markTipPaidBySessionId).not.toHaveBeenCalled();
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
    expect(markTipPaidBySessionId).not.toHaveBeenCalled();
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

  it("is not sent when no checkout matched the session (a tip)", async () => {
    vi.mocked(markCheckoutPaidBySessionId).mockResolvedValue(null);
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
