import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { nowMs } from "../clock";
import { type SvixHeaders, verifyResendWebhook } from "./webhook";

const secret = `whsec_${Buffer.from("resend-test-signing-key").toString("base64")}`;

function signedHeaders(
  payload: string,
  timestamp: number,
  options: { id?: string; signingSecret?: string } = {},
): SvixHeaders {
  const id = options.id ?? "msg_1";
  const base64 = (options.signingSecret ?? secret).replace(/^whsec_/, "");
  const signature = createHmac("sha256", Buffer.from(base64, "base64"))
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  return { id, timestamp: String(timestamp), signature: `v1,${signature}` };
}

const eventPayload = JSON.stringify({
  type: "email.delivered",
  created_at: "2026-07-24T12:00:00.000Z",
  data: { email_id: "9c4e1b60-0f42-4c86-9f2b-2c8a5f0f9a11", to: ["diver@example.com"] },
});

describe("resend webhook verification", () => {
  it("is not_configured without a signing secret", () => {
    const headers = signedHeaders(eventPayload, Math.floor(nowMs() / 1000));
    expect(verifyResendWebhook(eventPayload, headers, undefined)).toEqual({
      status: "not_configured",
    });
  });

  it("verifies a correctly signed event", () => {
    const headers = signedHeaders(eventPayload, Math.floor(nowMs() / 1000));
    const result = verifyResendWebhook(eventPayload, headers, secret);
    expect(result.status).toBe("verified");
    if (result.status !== "verified") return;
    expect(result.event.type).toBe("email.delivered");
    expect(result.eventId).toBe("msg_1");
  });

  it("accepts a secret written without the whsec_ label", () => {
    const bare = secret.replace(/^whsec_/, "");
    const headers = signedHeaders(eventPayload, Math.floor(nowMs() / 1000));
    expect(verifyResendWebhook(eventPayload, headers, bare).status).toBe("verified");
  });

  it("accepts a rotated secret's second signature in the same header", () => {
    const timestamp = Math.floor(nowMs() / 1000);
    const stale = signedHeaders(eventPayload, timestamp, { signingSecret: "whsec_b2xk" });
    const live = signedHeaders(eventPayload, timestamp);
    const headers: SvixHeaders = {
      ...live,
      signature: `${stale.signature} ${live.signature}`,
    };
    expect(verifyResendWebhook(eventPayload, headers, secret).status).toBe("verified");
  });

  it.each([
    ["id", { id: null }],
    ["timestamp", { timestamp: null }],
    ["signature", { signature: null }],
  ])("is invalid_signature with a missing svix-%s header", (_label, missing) => {
    const headers = { ...signedHeaders(eventPayload, Math.floor(nowMs() / 1000)), ...missing };
    expect(verifyResendWebhook(eventPayload, headers, secret)).toEqual({
      status: "invalid_signature",
    });
  });

  it("is invalid_signature when the HMAC doesn't match", () => {
    const headers = signedHeaders(eventPayload, Math.floor(nowMs() / 1000), {
      signingSecret: "whsec_d3Jvbmc=",
    });
    expect(verifyResendWebhook(eventPayload, headers, secret)).toEqual({
      status: "invalid_signature",
    });
  });

  it("is invalid_signature when the id is swapped after signing", () => {
    const headers = signedHeaders(eventPayload, Math.floor(nowMs() / 1000));
    expect(verifyResendWebhook(eventPayload, { ...headers, id: "msg_other" }, secret)).toEqual({
      status: "invalid_signature",
    });
  });

  it("is invalid_signature when the payload is tampered with after signing", () => {
    const headers = signedHeaders(eventPayload, Math.floor(nowMs() / 1000));
    const tampered = eventPayload.replace("email.delivered", "email.bounced");
    expect(verifyResendWebhook(tampered, headers, secret)).toEqual({
      status: "invalid_signature",
    });
  });

  it("is invalid_signature when the timestamp is stale", () => {
    const headers = signedHeaders(eventPayload, Math.floor(nowMs() / 1000) - 10_000);
    expect(verifyResendWebhook(eventPayload, headers, secret)).toEqual({
      status: "invalid_signature",
    });
  });

  it("is invalid_signature when the signature carries no v1 entry", () => {
    const headers = signedHeaders(eventPayload, Math.floor(nowMs() / 1000));
    expect(verifyResendWebhook(eventPayload, { ...headers, signature: "v0,abcd" }, secret)).toEqual(
      { status: "invalid_signature" },
    );
  });

  it("is malformed when the signed body isn't a Resend event", () => {
    const payload = JSON.stringify({ nope: true });
    const headers = signedHeaders(payload, Math.floor(nowMs() / 1000));
    expect(verifyResendWebhook(payload, headers, secret)).toEqual({ status: "malformed" });
  });

  it("is malformed when the signed body isn't JSON", () => {
    const payload = "not json";
    const headers = signedHeaders(payload, Math.floor(nowMs() / 1000));
    expect(verifyResendWebhook(payload, headers, secret)).toEqual({ status: "malformed" });
  });
});
