import { z } from "zod";
import type { ProviderEmailStatus } from "./events";

/**
 * Turns a verified SES event (the JSON carried inside an SNS `Notification`
 * message's `Message` field) into the same delivery-outcome shape
 * `parseResendEmailEvent` produces, so `/api/webhooks/ses` can hand both off
 * to the identical `applyProviderEmailEvent` — the dashboard/issue-surfacing
 * code downstream needs no changes to support a second provider. `Open` and
 * `Click` are handled by a separate engagement-tracking path, not this
 * delivery-status one; `Subscription` and anything unmodeled reduce to
 * `ignored`.
 */
const PROVIDER_STATUS_BY_SES_EVENT_TYPE = {
  Send: "sent",
  Delivery: "delivered",
  DeliveryDelay: "delivery_delayed",
  Bounce: "bounced",
  Complaint: "complained",
  Reject: "failed",
  RenderingFailure: "failed",
} as const satisfies Record<string, ProviderEmailStatus>;

const sesEventDataSchema = z.object({
  eventType: z.string().min(1),
  mail: z.object({
    messageId: z.string().min(1),
    timestamp: z.string().min(1).optional(),
  }),
  bounce: z
    .object({
      timestamp: z.string().optional(),
      bounceType: z.string().optional(),
      bounceSubType: z.string().optional(),
      bouncedRecipients: z.array(z.object({ diagnosticCode: z.string().optional() })).optional(),
    })
    .optional(),
  complaint: z
    .object({
      timestamp: z.string().optional(),
      complaintFeedbackType: z.string().optional(),
    })
    .optional(),
  delivery: z.object({ timestamp: z.string().optional() }).optional(),
  deliveryDelay: z
    .object({ timestamp: z.string().optional(), delayType: z.string().optional() })
    .optional(),
  reject: z.object({ reason: z.string().optional() }).optional(),
  failure: z.object({ errorMessage: z.string().optional() }).optional(),
});

export type SesEmailEvent =
  | {
      kind: "delivery";
      providerMessageId: string;
      status: ProviderEmailStatus;
      /** The provider's explanation for a bounce, complaint, reject, or rendering failure, when it gave one. */
      detail: string | null;
      occurredAt: Date;
    }
  | { kind: "ignored" };

function timestampFrom(candidates: readonly (string | undefined)[], fallback: Date): Date {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function sesEventDetail(data: z.infer<typeof sesEventDataSchema>): string | null {
  const bounceDiagnostic = data.bounce?.bouncedRecipients?.[0]?.diagnosticCode?.trim();
  if (bounceDiagnostic) return bounceDiagnostic;
  const bounceClassification = [data.bounce?.bounceType, data.bounce?.bounceSubType]
    .filter(Boolean)
    .join(" / ");
  if (bounceClassification) return bounceClassification;
  const complaintType = data.complaint?.complaintFeedbackType?.trim();
  if (complaintType) return complaintType;
  const rejectReason = data.reject?.reason?.trim();
  if (rejectReason) return rejectReason;
  const failureMessage = data.failure?.errorMessage?.trim();
  if (failureMessage) return failureMessage;
  return null;
}

export function parseSesEmailEvent(rawMessage: string, now: Date): SesEmailEvent {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawMessage);
  } catch {
    return { kind: "ignored" };
  }
  const data = sesEventDataSchema.safeParse(parsedJson);
  if (!data.success) return { kind: "ignored" };

  const status =
    PROVIDER_STATUS_BY_SES_EVENT_TYPE[
      data.data.eventType as keyof typeof PROVIDER_STATUS_BY_SES_EVENT_TYPE
    ];
  if (!status) return { kind: "ignored" };

  return {
    kind: "delivery",
    providerMessageId: data.data.mail.messageId,
    status,
    detail: sesEventDetail(data.data),
    occurredAt: timestampFrom(
      [
        data.data.bounce?.timestamp,
        data.data.complaint?.timestamp,
        data.data.delivery?.timestamp,
        data.data.deliveryDelay?.timestamp,
        data.data.mail.timestamp,
      ],
      now,
    ),
  };
}
