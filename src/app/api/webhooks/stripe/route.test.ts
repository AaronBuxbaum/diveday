import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nowMs } from "@/lib/clock";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/checkouts", () => ({
  markCheckoutPaidBySessionId: vi.fn(),
  markCheckoutExpiredBySessionId: vi.fn(),
}));
vi.mock("@/db/orders", () => ({
  markOrderPaidByInvoiceId: vi.fn(),
  markOrderVoidedByInvoiceId: vi.fn(),
}));
vi.mock("@/db/stripe-accounts", () => ({
  setShopStripeAccountStatus: vi.fn(),
  disconnectShopStripeAccount: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const { markCheckoutPaidBySessionId, markCheckoutExpiredBySessionId } = await import(
  "@/db/checkouts"
);
const { markOrderPaidByInvoiceId, markOrderVoidedByInvoiceId } = await import("@/db/orders");
const { setShopStripeAccountStatus, disconnectShopStripeAccount } = await import(
  "@/db/stripe-accounts"
);
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
  return JSON.stringify(event);
}

beforeEach(() => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
  vi.mocked(getDb).mockResolvedValue(FAKE_DB as never);
  vi.mocked(markCheckoutPaidBySessionId).mockReset();
  vi.mocked(markCheckoutExpiredBySessionId).mockReset();
  vi.mocked(markOrderPaidByInvoiceId).mockReset();
  vi.mocked(markOrderVoidedByInvoiceId).mockReset();
  vi.mocked(setShopStripeAccountStatus).mockReset();
  vi.mocked(disconnectShopStripeAccount).mockReset();
});

describe("POST /api/webhooks/stripe — fails closed on a bad signature", () => {
  it("returns 503 when no webhook secret is configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
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
    expect(markOrderPaidByInvoiceId).toHaveBeenCalledWith(FAKE_DB, "in_123", 4500);
  });

  it("invoice.paid defaults amount to 0 when Stripe omits it", async () => {
    const response = await post({
      id: "evt_1",
      type: "invoice.paid",
      data: { object: { id: "in_123" } },
    });
    expect(response.status).toBe(200);
    expect(markOrderPaidByInvoiceId).toHaveBeenCalledWith(FAKE_DB, "in_123", 0);
  });

  it("invoice.voided marks the order void", async () => {
    const response = await post({
      id: "evt_1",
      type: "invoice.voided",
      data: { object: { id: "in_123" } },
    });
    expect(response.status).toBe(200);
    expect(markOrderVoidedByInvoiceId).toHaveBeenCalledWith(FAKE_DB, "in_123");
  });

  it("checkout.session.completed with payment_status paid marks the checkout paid", async () => {
    const response = await post({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_123", payment_status: "paid" } },
    });
    expect(response.status).toBe(200);
    expect(markCheckoutPaidBySessionId).toHaveBeenCalledWith(FAKE_DB, "cs_123");
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
    expect(markCheckoutPaidBySessionId).toHaveBeenCalledWith(FAKE_DB, "cs_123");
  });

  it("checkout.session.expired marks the checkout expired", async () => {
    const response = await post({
      id: "evt_1",
      type: "checkout.session.expired",
      data: { object: { id: "cs_123" } },
    });
    expect(response.status).toBe(200);
    expect(markCheckoutExpiredBySessionId).toHaveBeenCalledWith(FAKE_DB, "cs_123");
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
