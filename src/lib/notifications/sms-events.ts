import { z } from "zod";
import type { ProviderEmailStatus } from "./events";

/**
 * SMS delivery receipts from AWS SNS (docs ADR 20260802-sms-delivery-receipts).
 *
 * This is the SMS half of what the WhatsApp and email channels already have:
 * a send only tells you the provider *accepted* the message, and what actually
 * happened to it arrives later.
 *
 * SNS reports it in a shape unlike either of the others, and that shape drives
 * this whole module. There is **no delivery webhook** for a direct-to-phone
 * `Publish` — SNS writes receipts to CloudWatch Logs and nowhere else. Getting
 * them here therefore takes an AWS-side pipeline (a Logs subscription filter →
 * a forwarder → an SNS topic → `/api/webhooks/sms`), and what finally lands is
 * a *log record*, not an event envelope of SNS's own design.
 *
 * So this module parses the CloudWatch record, and the route around it reuses
 * the same SNS message verification the SES webhook already does. That is the
 * only reason a second hop through SNS is worth it: it makes the receipt
 * arrive over a transport DiveDay already knows how to authenticate.
 */

/**
 * SNS reports a binary outcome, which is less than email or WhatsApp give.
 *
 * `SUCCESS` maps to `delivered` rather than `sent` deliberately: SNS considers
 * a message successful once the carrier confirms handset delivery, which is the
 * same thing `delivered` means everywhere else in this table. Reporting it as
 * `sent` would understate what is actually known and leave every SMS looking
 * permanently in-flight on the staff dashboard.
 */
const PROVIDER_STATUS_BY_SMS_STATUS: Record<string, ProviderEmailStatus | undefined> = {
  SUCCESS: "delivered",
  FAILURE: "failed",
};

const smsReceiptSchema = z.object({
  notification: z.object({
    /** The same id `Publish` returned and `recordNotificationDelivery` stored. */
    messageId: z.string().min(1),
    timestamp: z.string().min(1).optional(),
  }),
  delivery: z
    .object({
      providerResponse: z.string().optional(),
      destination: z.string().optional(),
      phoneCarrier: z.string().optional(),
      smsType: z.string().optional(),
    })
    .optional(),
  status: z.string().min(1),
});

export type SmsDeliveryEvent =
  | {
      kind: "delivery";
      providerMessageId: string;
      status: ProviderEmailStatus;
      /** The carrier's own explanation, which is the only useful part of a failure. */
      detail: string | null;
      occurredAt: Date;
    }
  | { kind: "ignored" };

/**
 * Parse one CloudWatch SMS delivery record.
 *
 * Takes the record as a string because that is how it arrives — the forwarder
 * republishes each log line verbatim as an SNS message body, so this sees the
 * same bytes CloudWatch wrote. Anything unparseable reduces to `ignored`
 * rather than throwing: SNS retries a non-2xx, and one malformed line must not
 * buy an endless redelivery of the batch it arrived in.
 */
export function parseSmsDeliveryEvent(record: string, now: Date): SmsDeliveryEvent {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(record);
  } catch {
    return { kind: "ignored" };
  }
  const receipt = smsReceiptSchema.safeParse(parsedJson);
  if (!receipt.success) return { kind: "ignored" };

  const status = PROVIDER_STATUS_BY_SMS_STATUS[receipt.data.status.toUpperCase()];
  if (!status) return { kind: "ignored" };

  return {
    kind: "delivery",
    providerMessageId: receipt.data.notification.messageId,
    status,
    // Only on a failure. `providerResponse` on a success is a cheerful
    // "Message has been accepted by phone", which is noise on a row whose
    // status already says delivered.
    detail: status === "failed" ? (receipt.data.delivery?.providerResponse?.trim() ?? null) : null,
    occurredAt: timestampFrom(receipt.data.notification.timestamp, now),
  };
}

/**
 * CloudWatch writes an ISO-8601 stamp; anything unparseable falls back to now
 * so a row always has a time, matching `parseSesEmailEvent`.
 */
function timestampFrom(timestamp: string | undefined, fallback: Date): Date {
  if (!timestamp) return fallback;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}
