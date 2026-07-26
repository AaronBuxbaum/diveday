import { z } from "zod";
import type { ResendWebhookEvent } from "./webhook";

/**
 * Turns a verified Resend event into the one thing this application acts on: a
 * delivery outcome for a message we sent
 * (20260726-hosted-mailboxes-for-platform-mail). Everything else — inbound
 * mail, which is a hosted mailbox's job rather than ours, domain, contact, and
 * suppression-list events, plus open/click tracking we deliberately do not
 * record — reduces to `ignored`, so an endpoint subscribed to more events than
 * it handles still answers 200 rather than erroring.
 */

/** Resend's `email.*` types mapped onto the provider-status enum we persist. */
const PROVIDER_STATUS_BY_TYPE = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.suppressed": "suppressed",
} as const;

export type ProviderEmailStatus =
  (typeof PROVIDER_STATUS_BY_TYPE)[keyof typeof PROVIDER_STATUS_BY_TYPE];

const deliveryDataSchema = z.object({
  email_id: z.string().min(1),
  created_at: z.string().min(1).optional(),
  bounce: z
    .object({
      type: z.string().optional(),
      subType: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
  failed: z.object({ reason: z.string().optional() }).optional(),
});

export type ResendEmailEvent =
  | {
      kind: "delivery";
      providerMessageId: string;
      status: ProviderEmailStatus;
      /** The provider's explanation for a bounce or failure, when it gave one. */
      detail: string | null;
      occurredAt: Date;
    }
  | { kind: "ignored" };

/**
 * A bounce's own message is the useful half ("mailbox unavailable"); the
 * type/subType pair only adds value when there is no message.
 */
function deliveryDetail(data: z.infer<typeof deliveryDataSchema>): string | null {
  const bounceMessage = data.bounce?.message?.trim();
  if (bounceMessage) return bounceMessage;
  const failedReason = data.failed?.reason?.trim();
  if (failedReason) return failedReason;
  const classification = [data.bounce?.type, data.bounce?.subType].filter(Boolean).join(" / ");
  return classification || null;
}

/** Falls back to the event's own stamp, then to now, so a row always has a time. */
function timestampFrom(candidates: readonly (string | undefined)[], fallback: Date): Date {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

export function parseResendEmailEvent(event: ResendWebhookEvent, now: Date): ResendEmailEvent {
  const status = PROVIDER_STATUS_BY_TYPE[event.type as keyof typeof PROVIDER_STATUS_BY_TYPE];
  if (!status) return { kind: "ignored" };
  const data = deliveryDataSchema.safeParse(event.data);
  if (!data.success) return { kind: "ignored" };
  return {
    kind: "delivery",
    providerMessageId: data.data.email_id,
    status,
    detail: deliveryDetail(data.data),
    occurredAt: timestampFrom([event.created_at, data.data.created_at], now),
  };
}

/**
 * Provider outcomes a shop must actually chase: the diver never got the email,
 * or told the provider it was spam. A delay is transient and a suppression is
 * already surfaced by the bounce that caused it.
 */
export const ACTIONABLE_PROVIDER_STATUSES = [
  "bounced",
  "complained",
  "failed",
] as const satisfies readonly ProviderEmailStatus[];

export function isActionableProviderStatus(status: ProviderEmailStatus | null): boolean {
  return status !== null && (ACTIONABLE_PROVIDER_STATUSES as readonly string[]).includes(status);
}
