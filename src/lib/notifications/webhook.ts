import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { nowMs } from "../clock";

/**
 * Resend webhook signature verification, done by hand against the Svix scheme
 * Resend delivers webhooks over (`svix-id`, `svix-timestamp`, `svix-signature`)
 * so the webhook route needs no SDK dependency — the same call made for the
 * Stripe Connect endpoint in `src/lib/payments/webhook.ts`. Fails closed: an
 * invalid or stale signature, or a missing secret, never reaches event handling.
 */

/**
 * Only the events we act on are modelled. `data` stays open because each event
 * type carries its own shape; the route parses the fields it needs per type.
 */
const resendEventSchema = z.object({
  type: z.string().min(1),
  created_at: z.string().min(1).optional(),
  data: z.record(z.string(), z.unknown()),
});

export type ResendWebhookEvent = z.infer<typeof resendEventSchema>;

export type ResendWebhookVerification =
  | { status: "verified"; event: ResendWebhookEvent; eventId: string }
  | { status: "not_configured" }
  | { status: "invalid_signature" }
  | { status: "malformed" };

export type SvixHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

/** Svix signs with the raw secret bytes, which are base64 behind a `whsec_` label. */
function signingKey(secret: string): Buffer {
  const base64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return Buffer.from(base64, "base64");
}

/**
 * `svix-signature` is space-delimited and versioned (`v1,<base64> v1,<base64>`)
 * so a secret can be rotated with both signatures live. Anything that isn't v1
 * is ignored rather than guessed at.
 */
function v1Signatures(header: string): string[] {
  return header
    .split(" ")
    .filter((part) => part.startsWith("v1,"))
    .map((part) => part.slice("v1,".length));
}

function isSignatureMatch(expectedBase64: string, candidateBase64: string): boolean {
  const expected = Buffer.from(expectedBase64, "base64");
  const candidate = Buffer.from(candidateBase64, "base64");
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

/**
 * `toleranceSeconds` guards against a replayed old event; Svix's own libraries
 * default to 300s, matched here.
 *
 * Seen `svix-id`s are deliberately not recorded, so a correctly-signed event
 * *can* be replayed inside that window. What makes that harmless is that every
 * handler is idempotent — inbound mail is unique on `provider_email_id`, and a
 * delivery outcome is a timestamp-guarded overwrite of the same value. A
 * future handler with a side effect that isn't (sending a reply, charging
 * something) must not inherit that assumption without adding id-level dedup.
 */
export function verifyResendWebhook(
  payload: string,
  headers: SvixHeaders,
  secret: string | undefined,
  toleranceSeconds = 300,
): ResendWebhookVerification {
  if (!secret) return { status: "not_configured" };

  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { status: "invalid_signature" };

  const expected = createHmac("sha256", signingKey(secret))
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  const candidates = v1Signatures(signature);
  if (candidates.length === 0) return { status: "invalid_signature" };

  const matches = candidates.some((candidate) => {
    try {
      return isSignatureMatch(expected, candidate);
    } catch {
      return false;
    }
  });
  if (!matches) return { status: "invalid_signature" };

  const ageSeconds = Math.abs(nowMs() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > toleranceSeconds) {
    return { status: "invalid_signature" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(payload);
  } catch {
    return { status: "malformed" };
  }
  const event = resendEventSchema.safeParse(parsedJson);
  if (!event.success) return { status: "malformed" };
  return { status: "verified", event: event.data, eventId: id };
}
