import { toE164 } from "../../lib/phone";

/** E.164 as SNS dials it: a `+`, no leading zero, seven to fifteen digits. */
const DIALABLE = /^\+[1-9]\d{6,14}$/;

/**
 * **Answering a date request from DiveDay** (issue #2555): a short reply the
 * staffer types under the lead, sent on the channel the diver left, recorded
 * against the request, and closing it as `replied`.
 *
 * The rules are here so the page that offers the form and the writer that sends
 * it cannot disagree about whether a reply can go, and on what.
 */

/** The longest reply, in characters, once trimmed. A reply, not a letter. */
export const INTEREST_REPLY_MAX = 1_000;

/**
 * The most replies one request takes in a day, whether they went or not. A
 * reply closes the lead and Reopen opens it again, so without this one lead
 * could be texted without end; past it, the staffer answers from their own
 * email or phone.
 */
export const INTEREST_REPLY_DAILY_CAP = 3;

/** How a reply reaches the diver: their email, or a text to the number they left. */
export type InterestReplyRoute = { channel: "email"; to: string } | { channel: "text"; to: string };

/**
 * Where a reply to this request goes, or null when it cannot go from DiveDay.
 * Email when the diver left an address: it carries paragraphs and the shop's
 * reply-to. Otherwise a text, but only to a number that reads as E.164 against
 * the shop's own country (`toE164`), because a send to a guessed number reaches
 * a stranger. Null leaves the row its `mailto:`/`tel:` link and nothing else.
 */
export function interestReplyRoute(
  contact: { email: string | null; phone: string | null },
  shopCountry: string | null | undefined,
): InterestReplyRoute | null {
  const email = contact.email?.trim();
  if (email) return { channel: "email", to: email };
  const phone = toE164(contact.phone, shopCountry);
  return phone && DIALABLE.test(phone) ? { channel: "text", to: phone } : null;
}

export type InterestReplyProblem = "empty" | "too_long";

/** The reply as it is sent and stored: line endings made one kind, and trimmed. */
export function normalizeInterestReply(body: string): string {
  return body.replace(/\r\n?/g, "\n").trim();
}

/** Why a reply may not be sent as written, or null when it may. */
export function interestReplyProblem(body: string): InterestReplyProblem | null {
  const normalized = normalizeInterestReply(body);
  if (normalized.length === 0) return "empty";
  if (normalized.length > INTEREST_REPLY_MAX) return "too_long";
  return null;
}

/**
 * A text is one line: every run of whitespace, newlines included, becomes one
 * space. WhatsApp's template parameters refuse a newline, and SMS reads as one
 * paragraph anyway.
 */
export function foldInterestReplyForText(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}
