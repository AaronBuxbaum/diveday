import { createHmac } from "node:crypto";
export const secret = "whsec_test";

export function signedHeader(payload: string, timestamp: number, signingSecret = secret) {
  const signature = createHmac("sha256", signingSecret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

export function webhookRequest(payload: string, signature: string | null) {
  const headers: Record<string, string> = {};
  if (signature !== null) headers["stripe-signature"] = signature;
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers,
    body: payload,
  });
}

export function eventPayload(event: Record<string, unknown>) {
  // Every test in this file signs with the "live" secret (STRIPE_WEBHOOK_SECRET)
  // unless it explicitly overrides `livemode` or signs with the test secret, so
  // default livemode:true keeps the whole suite realistic without touching
  // every call site individually.
  return JSON.stringify({ livemode: true, ...event });
}
