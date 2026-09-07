import { z } from "zod";

/**
 * The notification SES publishes when a receipt rule's S3 action has stored
 * an incoming message (ADR 20260907-two-way-inbox): the JSON inside an SNS
 * `Notification`'s `Message`. It carries the envelope — who sent it, who it
 * was addressed to, SES's own id for it, the scan verdicts — and *where the
 * bytes went*, never the bytes themselves. `/api/webhooks/email-inbound`
 * reads it, refuses what it should, and fetches the object it names.
 *
 * Same posture as `ses-events.ts`: anything unmodelled reduces to `ignored`
 * rather than throwing, because SNS retries a non-2xx.
 */

const verdictSchema = z.object({ status: z.string().optional() }).optional();

const receivedSchema = z.object({
  notificationType: z.literal("Received"),
  receipt: z.object({
    timestamp: z.string().optional(),
    /** The envelope recipients this rule matched — the `reply+<token>@…` addresses. */
    recipients: z.array(z.string()).optional(),
    spamVerdict: verdictSchema,
    virusVerdict: verdictSchema,
    action: z.object({
      type: z.string(),
      bucketName: z.string().optional(),
      objectKey: z.string().optional(),
    }),
  }),
  mail: z.object({
    /** SES's id for the received message — also the S3 object's key. */
    messageId: z.string().min(1),
    timestamp: z.string().optional(),
    /** The envelope sender (MAIL FROM). */
    source: z.string().optional(),
    destination: z.array(z.string()).optional(),
  }),
});

export type SesInboundNotification =
  | {
      kind: "received";
      providerMessageId: string;
      bucketName: string;
      objectKey: string;
      recipients: string[];
      envelopeFrom: string | null;
      receivedAt: Date;
    }
  | { kind: "ignored"; reason: "malformed" | "not_received" | "not_s3" | "virus" };

export function parseSesInboundNotification(message: string, now: Date): SesInboundNotification {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(message);
  } catch {
    return { kind: "ignored", reason: "malformed" };
  }
  const type = (parsedJson as { notificationType?: unknown } | null)?.notificationType;
  if (type !== "Received") return { kind: "ignored", reason: "not_received" };
  const parsed = receivedSchema.safeParse(parsedJson);
  if (!parsed.success) return { kind: "ignored", reason: "malformed" };
  const { receipt, mail } = parsed.data;
  // A message SES's own scanner flagged never reaches a staffer's screen. Spam
  // is *not* refused here: a diver's reply from a hotel Wi-Fi trips that
  // verdict often enough that dropping it would lose real answers, and the
  // row is text on a staff page rather than anything that executes.
  if (receipt.virusVerdict?.status?.toUpperCase() === "FAIL") {
    return { kind: "ignored", reason: "virus" };
  }
  if (receipt.action.type !== "S3" || !receipt.action.bucketName || !receipt.action.objectKey) {
    return { kind: "ignored", reason: "not_s3" };
  }
  const stamp = mail.timestamp ?? receipt.timestamp;
  const receivedAt = stamp && !Number.isNaN(Date.parse(stamp)) ? new Date(stamp) : now;
  return {
    kind: "received",
    providerMessageId: mail.messageId,
    bucketName: receipt.action.bucketName,
    objectKey: receipt.action.objectKey,
    recipients: receipt.recipients ?? mail.destination ?? [],
    envelopeFrom: mail.source ?? null,
    receivedAt,
  };
}
