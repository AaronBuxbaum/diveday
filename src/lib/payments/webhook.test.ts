import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeWebhook } from "./webhook";

const secret = "whsec_test";

function signedHeader(payload: string, timestamp: number, signingSecret = secret) {
  const signature = createHmac("sha256", signingSecret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

const eventPayload = JSON.stringify({
  id: "evt_1",
  type: "invoice.paid",
  account: "acct_123",
  data: { object: { id: "in_1", status: "paid" } },
});

describe("stripe webhook verification", () => {
  it("is not_configured without a signing secret", () => {
    const header = signedHeader(eventPayload, Math.floor(Date.now() / 1000));
    expect(verifyStripeWebhook(eventPayload, header, undefined)).toEqual({
      status: "not_configured",
    });
  });

  it("is invalid_signature with a missing header", () => {
    expect(verifyStripeWebhook(eventPayload, null, secret)).toEqual({
      status: "invalid_signature",
    });
  });

  it("is invalid_signature when the HMAC doesn't match", () => {
    const header = signedHeader(eventPayload, Math.floor(Date.now() / 1000), "whsec_wrong");
    expect(verifyStripeWebhook(eventPayload, header, secret)).toEqual({
      status: "invalid_signature",
    });
  });

  it("is invalid_signature when the timestamp is stale", () => {
    const staleTimestamp = Math.floor(Date.now() / 1000) - 10_000;
    const header = signedHeader(eventPayload, staleTimestamp);
    expect(verifyStripeWebhook(eventPayload, header, secret)).toEqual({
      status: "invalid_signature",
    });
  });

  it("is invalid_signature when the payload was tampered with after signing", () => {
    const header = signedHeader(eventPayload, Math.floor(Date.now() / 1000));
    const tampered = eventPayload.replace("in_1", "in_evil");
    expect(verifyStripeWebhook(tampered, header, secret)).toEqual({
      status: "invalid_signature",
    });
  });

  it("verifies a correctly signed, fresh event and parses it", () => {
    const header = signedHeader(eventPayload, Math.floor(Date.now() / 1000));
    const result = verifyStripeWebhook(eventPayload, header, secret);
    expect(result).toEqual({
      status: "verified",
      event: {
        id: "evt_1",
        type: "invoice.paid",
        account: "acct_123",
        data: { object: { id: "in_1", status: "paid" } },
      },
    });
  });

  it("is malformed when the signature is valid but the body isn't a Stripe event", () => {
    const payload = JSON.stringify({ hello: "world" });
    const header = signedHeader(payload, Math.floor(Date.now() / 1000));
    expect(verifyStripeWebhook(payload, header, secret)).toEqual({ status: "malformed" });
  });
});
