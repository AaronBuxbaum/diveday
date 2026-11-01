import { HOUR_MS } from "@/lib/clock";
import { phoneDigits } from "@/lib/person-fields";
import { toE164 } from "@/lib/phone";
import { hasSailed } from "@/lib/trips";

/**
 * The rules of the shop inbox, free of any framework (ADR
 * 20260907-two-way-inbox): how an inbound address is made comparable, when a
 * stored phone counts as the same number, what the reply-to token looks like
 * on the wire, and how long Meta lets a shop answer a WhatsApp in free text.
 *
 * Codes and values only — the words a staffer reads come from
 * `staff/inbox.json`.
 */

/** A channel a diver can write in on, and a webhook files. */
export type InboundChannel = "email" | "sms" | "whatsapp";

/**
 * Every source an Inbox row can have: the channels above, and the diver's own
 * booking page (`page`, an "Ask to move", H-20261014-ask-to-move). A page row has no address to
 * answer on, so it is never a reply target.
 */
export type InboxChannel = InboundChannel | "page";

/**
 * How close to its departure an "Ask to move" also emails owners and managers
 * (issue #2667, decided by Aaron 2026-10-17): within a day the Inbox may be
 * read too late; farther out it is enough.
 */
export const MOVE_ASK_ALERT_WINDOW_MS = 24 * HOUR_MS;

/** Whether an ask filed `now` about a seat leaving at `startsAt` emails staff. */
export function moveAskAlertDue(startsAt: Date, now: Date): boolean {
  return (
    !hasSailed(startsAt, now) && startsAt.getTime() - now.getTime() <= MOVE_ASK_ALERT_WINDOW_MS
  );
}

/** The longest note a diver may add to an "Ask to move" (H-20261014-ask-to-move). */
export const MOVE_ASK_NOTE_MAX_LENGTH = 500;

/**
 * The provider id an "Ask to move" is filed under: one per booking and
 * departure, so a second tap, a double submit or a back-button resend is the
 * same row, and a seat the desk moved can ask again about its new date.
 */
export function moveAskProviderId(bookingId: string, tripId: string): string {
  return `move-ask:${bookingId}:${tripId}`;
}

/**
 * How much of a diver's message is kept. A reply to a confirmation is a
 * paragraph; a forwarded thread with every quoted turn is not something a
 * staffer reads at the counter, and the row is not an archive of it.
 */
export const INBOUND_BODY_MAX_LENGTH = 20_000;

/** How much a staffer may write back in one go. */
export const REPLY_BODY_MAX_LENGTH = 4_000;

/**
 * Meta's customer-service window: a business may send free-form text only
 * within 24 hours of the customer's last message. Outside it, only an
 * approved template goes through, which is what the courtesy sender uses and
 * what a typed reply is not.
 */
export const WHATSAPP_REPLY_WINDOW_MS = 24 * HOUR_MS;

/** The local-part prefix of every shop's inbound reply address. */
export const INBOUND_REPLY_PREFIX = "reply+";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The bare address out of anything an email header carries — `Priya Sharma
 * <priya@example.com>`, `<priya@example.com>`, `PRIYA@Example.com ` — as one
 * comparable string. Null when there is no `@` to compare on.
 *
 * **The mailbox is the *last* angle-addr.** RFC 5322's `name-addr` is
 * `[display-name] angle-addr`, and a display name may be a quoted string
 * holding anything, angle brackets included. Taking the first `<…>` therefore
 * reads attacker-chosen text out of the display name rather than the address
 * the mail came from — and this function decides *whose record a message lands
 * on* in `/api/webhooks/email-inbound`, checked against a DMARC verdict SES
 * computed over the real mailbox. Reading the wrong end let anyone with a
 * DMARC-passing domain of their own write onto a named diver's record: the
 * verdict authenticated `evil.example`, and the sentence was filed under the
 * victim's address parked in the display name. `src/lib/inbox.test.ts` pins it.
 */
export function normalizeEmailAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const angled = [...raw.matchAll(/<([^<>]*)>/g)].at(-1);
  const candidate = (angled ? angled[1] : raw).trim().toLowerCase();
  // An addr-spec, not merely "has an @": this is the value compared against the
  // envelope and stored as the sender, so a header that is not one mailbox is
  // refused outright rather than normalised into something that looks like one.
  if (!/^[^\s@<>",;]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(candidate)) return null;
  return candidate;
}

/**
 * Whether a stored phone number is the one a message came from, read against
 * the country the shop itself is in (`shops.address_country`).
 *
 * The stored side is resolved to E.164 first (`toE164`) and then compared to
 * the inbound number for **equality**, digits to digits — `305-555-0110` on a
 * Key Largo diver's record becomes `+13055550110` and matches the
 * `13055550110` WhatsApp reports, and `612 345 678` on a Mallorca diver's
 * record becomes `+34612345678` and matches theirs.
 *
 * **This used to end in a suffix rule** — a stored number of ten digits or
 * more matched any inbound number ending in it — which was the North American
 * ten-digit national number written into a function that runs for every
 * country. A British record stored bare as `7700900123` matched a US inbound
 * `+1 770 090 0123`, and a stranger's message was filed on a named diver.
 * Equality replaces it; `src/lib/phone.test.ts` and the cases below pin both
 * halves.
 *
 * **The country is a fallback, not the input it looks like.** Every writer of
 * `people.phone` stores E.164 (`storedPhone`, src/db/person-phone.ts), so for
 * an ordinary row `toE164` here is a no-op that ignores `shopCountry`
 * entirely. That is deliberate: this function is where a bare column's meaning
 * used to follow the shop's address setting, which is the incident
 * `storedPhone` records. The resolution stays for the rows a writer could not
 * resolve either.
 *
 * Two honest costs, neither of them a bug to be fixed here:
 *
 * - A shop with **no country on file** — `address_country` is nullable and
 *   nothing makes a shop fill it in — gets exact-digit matching only. A number
 *   stored bare there stops matching an inbound `+1…` that it used to match by
 *   suffix. The shop fixes it by saving its address, which is a thing it can
 *   see and do.
 * - A number `toE164` cannot resolve at all (a note in the field, an extension,
 *   a shape no country above explains) falls back to exact digit equality, so
 *   it is never dropped from consideration and never guessed at either.
 */
export function phoneMatches(
  storedPhone: string | null | undefined,
  inboundDigits: string,
  shopCountry: string | null | undefined,
): boolean {
  if (!storedPhone || !inboundDigits) return false;
  const stored = phoneDigits(storedPhone);
  if (stored.length === 0) return false;
  const normalized = toE164(storedPhone, shopCountry);
  return normalized ? phoneDigits(normalized) === inboundDigits : stored === inboundDigits;
}

/** The digits-only form a WhatsApp or SMS sender is compared and stored as. */
export function normalizePhoneAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = phoneDigits(raw);
  return digits.length >= 7 ? digits : null;
}

/**
 * The destination a staff reply will actually be sent to, as a human can read
 * it.
 *
 * Email is the address verbatim. A phone address is stored digits-only
 * (`normalizePhoneAddress`), so it gets its `+` back and no grouping: DiveDay
 * does not know the country, and a guessed grouping would be a lie about a
 * number the staffer is being asked to eyeball before they send.
 */
export function replyDestination(channel: InboundChannel, fromAddress: string): string {
  if (channel === "email") return fromAddress;
  return fromAddress.startsWith("+") ? fromAddress : `+${fromAddress}`;
}

/** The address a shop's outbound mail asks replies to go to. */
export function inboundReplyAddress(token: string, domain: string): string {
  return `${INBOUND_REPLY_PREFIX}${token.toLowerCase()}@${domain.toLowerCase()}`;
}

/**
 * The shop token out of an address a message was sent to, or null for any
 * address that is not one of ours. Case-insensitive because mail servers are;
 * strict about the shape because the token is the only thing that names the
 * tenant, and "close enough" is how one shop reads another's mail.
 */
export function parseInboundReplyToken(
  address: string | null | undefined,
  domain: string,
): string | null {
  const normalized = normalizeEmailAddress(address);
  if (!normalized) return null;
  const at = normalized.lastIndexOf("@");
  if (normalized.slice(at + 1) !== domain.toLowerCase()) return null;
  const local = normalized.slice(0, at);
  if (!local.startsWith(INBOUND_REPLY_PREFIX)) return null;
  const token = local.slice(INBOUND_REPLY_PREFIX.length);
  return UUID_PATTERN.test(token) ? token : null;
}

/**
 * Whether a free-text WhatsApp reply may still go out, given when the diver
 * last wrote. `null` — they never wrote on WhatsApp — is closed: a business
 * cannot open the window itself.
 */
export function whatsAppReplyWindowOpen(lastInboundAt: Date | null, now: Date): boolean {
  if (!lastInboundAt) return false;
  const age = now.getTime() - lastInboundAt.getTime();
  return age >= 0 && age < WHATSAPP_REPLY_WINDOW_MS;
}

/**
 * **The approved messages that ask a diver to write back on WhatsApp**, once
 * the window has closed. Each is a fixed sentence from the diver bundle
 * (`notifications.whatsappReopen.*`), sent through the shop's one approved
 * courtesy template, so nothing a staffer types ever goes out as a template:
 * that is what would get a shop's template paused for misuse. The diver's
 * answer opens a fresh 24 hours, and the composer comes back.
 */
export const WHATSAPP_REOPEN_MESSAGES = ["answer_ready", "question", "follow_up"] as const;
export type WhatsAppReopenMessage = (typeof WHATSAPP_REOPEN_MESSAGES)[number];

/**
 * When the shop last asked this diver to write back, or null when it has not
 * since they last wrote.
 *
 * A WhatsApp reply sent a full window or more after the diver's last message
 * can only have been a template, because a typed one would have been refused,
 * so this needs no column of its own. One ask per silence: a second would be
 * the same request again, paid for again, to someone who has not answered the
 * first.
 */
export function whatsAppReopenSentAt(
  lastInboundAt: Date | null,
  sentWhatsAppReplies: readonly Date[],
): Date | null {
  if (!lastInboundAt) return null;
  const closesAt = lastInboundAt.getTime() + WHATSAPP_REPLY_WINDOW_MS;
  const asks = sentWhatsAppReplies.filter((sentAt) => sentAt.getTime() >= closesAt);
  if (asks.length === 0) return null;
  return new Date(Math.max(...asks.map((sentAt) => sentAt.getTime())));
}

/** Bound a body to what the row keeps, marking the cut. */
export function truncateInboundBody(body: string): string {
  const trimmed = body.replace(/\r\n/g, "\n").trim();
  return trimmed.length <= INBOUND_BODY_MAX_LENGTH
    ? trimmed
    : `${trimmed.slice(0, INBOUND_BODY_MAX_LENGTH - 1).trimEnd()}…`;
}

/**
 * The provider message id an email `In-Reply-To` header names, as the id SES
 * returned at send time. SES writes `Message-ID: <id@email.amazonses.com>` (or
 * `<id@<region>.amazonses.com>`) for every message it sends, so the local part
 * before the `@` is exactly `SendEmail`'s `MessageId`. Null for any other
 * sender's message id, which cannot match a delivery row anyway.
 */
export function sesMessageIdFromHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = header.match(/<([^<>@\s]+)@[^<>@\s]*amazonses\.com>/i);
  return match ? match[1] : null;
}

/**
 * The fragment one inbound message answers to on the diver's record, so the
 * inbox's door lands on the message it was opened from rather than the top
 * of the conversation. One spelling, shared by the link and the target.
 */
export function inboxMessageAnchor(messageId: string): string {
  return `message-${messageId}`;
}
