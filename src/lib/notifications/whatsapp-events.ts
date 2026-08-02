import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ProviderEmailStatus } from "./events";

/**
 * Meta's WhatsApp delivery webhook: signature verification and event parsing
 * (docs ADR 20260802-whatsapp-embedded-signup).
 *
 * This endpoint exists *because* onboarding moved to Embedded Signup. Meta
 * delivers webhooks per Meta app, signed with that app's secret — so under the
 * old paste-your-own-credentials flow each shop's events were signed with a
 * secret DiveDay never held, and a single endpoint could not verify any of
 * them. Embedded Signup subscribes every shop's WhatsApp Business Account to
 * **DiveDay's** app, so all of it arrives here under one secret.
 *
 * Hand-verified against Meta's `X-Hub-Signature-256` scheme rather than through
 * an SDK, the same call already made for Resend (`./webhook.ts`) and Stripe
 * (`src/lib/payments/webhook.ts`). Fails closed: an invalid signature, or a
 * missing secret, never reaches event handling.
 */

export type WhatsAppWebhookVerification =
  | { status: "verified" }
  | { status: "not_configured" }
  | { status: "invalid_signature" };

/**
 * Verify the raw request body against `X-Hub-Signature-256`.
 *
 * **The raw body, before any JSON parse.** Meta signs the exact bytes it sent,
 * and re-serializing a parsed object changes them — key order, whitespace, and
 * unicode escaping all differ — so a round-tripped payload never matches even
 * when it is completely genuine.
 */
export function verifyWhatsAppSignature(
  payload: string,
  signatureHeader: string | null,
  appSecret: string | undefined,
): WhatsAppWebhookVerification {
  if (!appSecret) return { status: "not_configured" };
  if (!signatureHeader?.startsWith("sha256=")) return { status: "invalid_signature" };

  const expected = createHmac("sha256", appSecret).update(payload, "utf8").digest("hex");
  const candidate = signatureHeader.slice("sha256=".length);
  // Compared as bytes of equal length; a length mismatch short-circuits because
  // timingSafeEqual throws on differing lengths rather than returning false.
  const expectedBytes = Buffer.from(expected, "hex");
  const candidateBytes = Buffer.from(candidate, "hex");
  if (expectedBytes.length === 0 || expectedBytes.length !== candidateBytes.length) {
    return { status: "invalid_signature" };
  }
  return timingSafeEqual(expectedBytes, candidateBytes)
    ? { status: "verified" }
    : { status: "invalid_signature" };
}

/**
 * Meta's one-time subscription handshake: it GETs the endpoint with a token it
 * was configured with and expects the challenge echoed back verbatim.
 *
 * Returns the challenge to echo, or null to refuse. Compared in constant time
 * for the same reason the signature is — the verify token is a shared secret,
 * and an endpoint that leaks it through response timing hands an attacker the
 * ability to pass this handshake.
 */
export function whatsAppChallengeResponse(
  params: URLSearchParams,
  verifyToken: string | undefined,
): string | null {
  if (!verifyToken) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  const presented = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (!presented || !challenge) return null;
  const expected = Buffer.from(verifyToken, "utf8");
  const candidate = Buffer.from(presented, "utf8");
  if (expected.length !== candidate.length || !timingSafeEqual(expected, candidate)) return null;
  return challenge;
}

/**
 * WhatsApp's statuses mapped onto the provider-status enum already persisted
 * for email (`notification_provider_status`).
 *
 * `read` is deliberately absent. DiveDay does not record opens for email — the
 * same judgement applies here, and a read receipt is not something a shop needs
 * to chase. It reduces to an ignored event rather than a new enum value.
 */
const PROVIDER_STATUS_BY_WHATSAPP_STATUS: Record<string, ProviderEmailStatus | undefined> = {
  sent: "sent",
  delivered: "delivered",
  failed: "failed",
};

const statusSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  timestamp: z.string().optional(),
  errors: z
    .array(
      z.object({
        code: z.number().optional(),
        title: z.string().optional(),
        message: z.string().optional(),
        error_data: z.object({ details: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

const payloadSchema = z.object({
  entry: z
    .array(
      z.object({
        /** The WhatsApp Business Account the events belong to — the tenant key. */
        id: z.string().min(1).optional(),
        changes: z
          .array(
            z.object({
              value: z.object({ statuses: z.array(statusSchema).optional() }).loose(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export type WhatsAppDeliveryEvent = {
  /**
   * The WABA that produced this event, or null when Meta did not name one.
   *
   * Carried so the caller can resolve it to a shop and scope the update to that
   * tenant. Without it, a delivery outcome is applied by provider message id
   * alone across a multi-tenant table, and the only thing keeping one shop's
   * webhook off another shop's row is "Meta ids are globally unique" — an
   * upstream property, not one this codebase enforces.
   */
  wabaId: string | null;
  providerMessageId: string;
  status: ProviderEmailStatus;
  /** Meta's own explanation for a failure, when it gave one. */
  detail: string | null;
  occurredAt: Date;
};

/**
 * Every delivery outcome in a verified payload.
 *
 * A batch can carry several, and an inbound *message* (a diver replying) rides
 * the same `messages` webhook field — that is the shop's own WhatsApp inbox to
 * answer, not DiveDay's, so it is simply not represented here. Anything
 * unparseable is skipped rather than failing the batch: Meta retries a non-2xx,
 * and one malformed entry must not buy an endless redelivery of the good ones.
 */
export function parseWhatsAppDeliveryEvents(payload: string, now: Date): WhatsAppDeliveryEvent[] {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(payload);
  } catch {
    return [];
  }
  const body = payloadSchema.safeParse(parsedJson);
  if (!body.success) return [];

  const events: WhatsAppDeliveryEvent[] = [];
  for (const entry of body.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value.statuses ?? []) {
        const mapped = PROVIDER_STATUS_BY_WHATSAPP_STATUS[status.status];
        if (!mapped) continue;
        events.push({
          wabaId: entry.id ?? null,
          providerMessageId: status.id,
          status: mapped,
          detail: failureDetail(status.errors),
          occurredAt: timestampFrom(status.timestamp, now),
        });
      }
    }
  }
  return events;
}

function failureDetail(errors: z.infer<typeof statusSchema>["errors"]): string | null {
  const first = errors?.[0];
  if (!first) return null;
  // `error_data.details` is the specific one ("Message failed to send because
  // more than 24 hours have passed"); title is the generic bucket.
  const detail = first.error_data?.details ?? first.message ?? first.title;
  return detail?.slice(0, 500) ?? null;
}

/** Meta sends unix **seconds** as a string; anything unparseable falls back to now. */
function timestampFrom(timestamp: string | undefined, fallback: Date): Date {
  if (!timestamp) return fallback;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return new Date(seconds * 1_000);
}
