import { z } from "zod";
import { smsRecipient } from "./sms";

/**
 * Replies to DiveDay's texting number (ADR 20261007-sms-stop-and-help).
 *
 * SMS stays one-way for conversation: nothing a diver writes back reaches a
 * shop (ADR 20260907-two-way-inbox, decision 7). The number is still two-way
 * for one reason, the carriers' keywords. AWS End User Messaging answers HELP
 * and STOP itself from the replies configured on the number, then forwards
 * every inbound message to the same SNS topic as the delivery receipts, and
 * this module reads the two words that change what DiveDay may send.
 *
 * HELP needs nothing from the app: the answer is AWS's to send, and it is the
 * same for every diver.
 */

/**
 * The opt-out words US carriers require a sender to honor (CTIA Messaging
 * Principles), plus the opt-in words that undo them. Matched against the whole
 * reply, not its first word, so "Stop by the shop at 7?" is not an opt-out.
 */
const STOP_WORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "OPTOUT",
  "REVOKE",
]);
const START_WORDS = new Set(["START", "UNSTOP"]);

/** The JSON AWS End User Messaging publishes for each inbound text. */
const inboundSchema = z.object({
  originationNumber: z.string().min(1),
  messageBody: z.string(),
});

export type SmsReply =
  | { kind: "stop"; phone: string }
  | { kind: "start"; phone: string }
  | { kind: "ignored" };

/**
 * Read one SNS message body. Anything that is not an inbound text, including
 * a delivery receipt arriving on the same topic, is `ignored`, never a throw:
 * SNS retries a non-2xx, and one odd message must not buy endless redelivery.
 */
export function parseSmsReply(raw: string): SmsReply {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { kind: "ignored" };
  }
  const inbound = inboundSchema.safeParse(parsedJson);
  if (!inbound.success) return { kind: "ignored" };

  const phone = smsRecipient(inbound.data.originationNumber);
  if (!phone) return { kind: "ignored" };
  const word = inbound.data.messageBody
    .trim()
    .replace(/[\s.!]+$/u, "")
    .toUpperCase();
  if (STOP_WORDS.has(word)) return { kind: "stop", phone };
  if (START_WORDS.has(word)) return { kind: "start", phone };
  return { kind: "ignored" };
}
