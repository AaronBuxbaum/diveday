import { createHmac } from "node:crypto";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { nowMs } from "../clock";
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
    const header = signedHeader(eventPayload, Math.floor(nowMs() / 1000));
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
    const header = signedHeader(eventPayload, Math.floor(nowMs() / 1000), "whsec_wrong");
    expect(verifyStripeWebhook(eventPayload, header, secret)).toEqual({
      status: "invalid_signature",
    });
  });

  it("is invalid_signature when the timestamp is stale", () => {
    const staleTimestamp = Math.floor(nowMs() / 1000) - 10_000;
    const header = signedHeader(eventPayload, staleTimestamp);
    expect(verifyStripeWebhook(eventPayload, header, secret)).toEqual({
      status: "invalid_signature",
    });
  });

  it("is invalid_signature when the payload was tampered with after signing", () => {
    const header = signedHeader(eventPayload, Math.floor(nowMs() / 1000));
    const tampered = eventPayload.replace("in_1", "in_evil");
    expect(verifyStripeWebhook(tampered, header, secret)).toEqual({
      status: "invalid_signature",
    });
  });

  it("verifies a correctly signed, fresh event and parses it", () => {
    const header = signedHeader(eventPayload, Math.floor(nowMs() / 1000));
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
    const header = signedHeader(payload, Math.floor(nowMs() / 1000));
    expect(verifyStripeWebhook(payload, header, secret)).toEqual({ status: "malformed" });
  });
});

/**
 * **The window is ours, both sides of now** (ADR 20261102-stripe-sdk-adapters).
 * The SDK's own check refuses only an event too old: a signed event stamped
 * ten minutes ahead passed it. These pin what the adapter adds on top.
 */
describe("stripe webhook verification against hostile headers", () => {
  const now = () => Math.floor(nowMs() / 1000);

  it("refuses an event stamped past the window in the future, which the SDK alone accepts", () => {
    const header = signedHeader(eventPayload, now() + 600);
    // The gap this closes: the SDK on its own lets it through.
    expect(() =>
      Stripe.webhooks.constructEvent(eventPayload, header, secret, 300, undefined, nowMs()),
    ).not.toThrow();
    expect(verifyStripeWebhook(eventPayload, header, secret)).toEqual({
      status: "invalid_signature",
    });
    expect(
      verifyStripeWebhook(eventPayload, signedHeader(eventPayload, now() + 301), secret),
    ).toEqual({ status: "invalid_signature" });
  });

  it("accepts an event inside the window on either side", () => {
    for (const offset of [-290, 290]) {
      const header = signedHeader(eventPayload, now() + offset);
      expect(verifyStripeWebhook(eventPayload, header, secret).status).toBe("verified");
    }
  });

  it("refuses a header with two timestamps, whichever one is signed", () => {
    const stale = now() - 10_000;
    const signedStale = signedHeader(eventPayload, stale);
    // A fresh `t` in front of a stale signed one, and the reverse.
    expect(verifyStripeWebhook(eventPayload, `t=${now()},${signedStale}`, secret)).toEqual({
      status: "invalid_signature",
    });
    expect(verifyStripeWebhook(eventPayload, `${signedStale},t=${now()}`, secret)).toEqual({
      status: "invalid_signature",
    });
  });

  it("refuses a timestamp that is not a plain number", () => {
    const fresh = now();
    const signature = signedHeader(eventPayload, fresh).split(",")[1];
    for (const t of [`${fresh}.5`, `0x${fresh.toString(16)}`, ` ${fresh}`, "", `${fresh}abc`]) {
      expect(verifyStripeWebhook(eventPayload, `t=${t},${signature}`, secret)).toEqual({
        status: "invalid_signature",
      });
    }
  });

  it("verifies the raw bytes it was given, not a re-serialization of them", () => {
    const spaced = JSON.stringify(JSON.parse(eventPayload), null, 2);
    const header = signedHeader(eventPayload, now());
    expect(verifyStripeWebhook(spaced, header, secret)).toEqual({ status: "invalid_signature" });
  });

  it("refuses a signature from the other mode's secret and a scheme other than v1", () => {
    const header = signedHeader(eventPayload, now(), "whsec_live_other");
    expect(verifyStripeWebhook(eventPayload, header, secret).status).toBe("invalid_signature");
    const v0 = signedHeader(eventPayload, now()).replace("v1=", "v0=");
    expect(verifyStripeWebhook(eventPayload, v0, secret).status).toBe("invalid_signature");
  });

  it("is malformed when the signed body is not JSON at all", () => {
    const payload = "not json";
    const header = signedHeader(payload, now());
    expect(verifyStripeWebhook(payload, header, secret)).toEqual({ status: "malformed" });
  });

  it("calls a header the SDK cannot read an invalid signature, not a malformed event", () => {
    const fresh = now();
    for (const header of [`t=${fresh}`, `t=${fresh},v1`, `t=${fresh},v1=`]) {
      expect(verifyStripeWebhook(eventPayload, header, secret)).toEqual({
        status: "invalid_signature",
      });
    }
  });
});
