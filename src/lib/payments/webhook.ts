import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Stripe Connect webhook signature verification, done by hand against the
 * documented `Stripe-Signature` scheme (`t=<timestamp>,v1=<hmac>[,v1=<hmac>]`)
 * so the webhook route needs no SDK dependency (docs ADR
 * 20260719-stripe-connect-orders). Fails closed: an invalid or stale
 * signature, or a missing secret, never reaches event handling.
 */

const stripeEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  /** The connected account the event happened on; absent for platform-only events. */
  account: z.string().min(1).optional(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

export type StripeWebhookEvent = z.infer<typeof stripeEventSchema>;

export type WebhookVerification =
  | { status: "verified"; event: StripeWebhookEvent }
  | { status: "not_configured" }
  | { status: "invalid_signature" }
  | { status: "malformed" };

function parseSignatureHeader(header: string): { timestamp: string; signatures: string[] } {
  const parts = header.split(",").map((part) => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1] ?? "";
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value ?? "");
  return { timestamp, signatures };
}

function isSignatureMatch(expectedHex: string, candidateHex: string): boolean {
  const expected = Buffer.from(expectedHex, "hex");
  const candidate = Buffer.from(candidateHex, "hex");
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

/**
 * `toleranceSeconds` guards against a replayed old event; Stripe's own
 * libraries default to 300s, matched here.
 */
export function verifyStripeWebhook(
  payload: string,
  signatureHeader: string | null,
  secret: string | undefined,
  toleranceSeconds = 300,
): WebhookVerification {
  if (!secret) return { status: "not_configured" };
  if (!signatureHeader) return { status: "invalid_signature" };

  const { timestamp, signatures } = parseSignatureHeader(signatureHeader);
  if (!timestamp || signatures.length === 0) return { status: "invalid_signature" };

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const matches = signatures.some((candidate) => {
    try {
      return isSignatureMatch(expected, candidate);
    } catch {
      return false;
    }
  });
  if (!matches) return { status: "invalid_signature" };

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > toleranceSeconds) {
    return { status: "invalid_signature" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(payload);
  } catch {
    return { status: "malformed" };
  }
  const event = stripeEventSchema.safeParse(parsedJson);
  if (!event.success) return { status: "malformed" };
  return { status: "verified", event: event.data };
}
