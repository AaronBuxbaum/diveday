import type { Notification } from "./kinds";

/**
 * **Whose name a message goes out under** (ux review 2026-10-11, item 3;
 * Aaron's decision on sender identity, 2026-10-11).
 *
 * A diver who booked with Blue Mantis got mail from "DiveDay", a company they
 * had never heard of, wearing DiveDay's teal, while the page it linked to wore
 * the shop's logo and colour. A message DiveDay sends *for* a shop now leaves
 * as "Blue Mantis via DiveDay" and opens with the shop's own mark; DiveDay is
 * the credit at the foot, as on the storefront (`shopChrome.credit`).
 *
 * The address does not change, and that is the half that keeps the mail
 * delivered: the `From` domain is still DiveDay's own verified SES identity,
 * so SPF and DKIM still align with it for DMARC. Only the display name moves.
 * A shop's own domain as the `From` is the later step for shops that ask
 * (per-shop SES verification), and nothing here assumes it.
 *
 * Returns the shop's name for a kind the shop speaks in, null for one where
 * DiveDay is the sender: account mail, platform alerts, and the staff-facing
 * digests DiveDay writes *to* a shop. One switch with no default, so a new
 * kind is a compile error here until somebody decides which it is.
 */
export function shopVoiceOf(notification: Notification): string | null {
  switch (notification.kind) {
    // The shore contact is asked by the shop it agrees to hear from (H-20261014-stale-roll-call-recipients);
    // the owner's own address and the front desk's are DiveDay asking.
    case "address_confirmation":
      return notification.purpose === "shore_alert" ? notification.shopName : null;
    case "booking_confirmation":
    case "waiver_request":
    case "guardian_release_copy":
    case "readiness_link":
    case "booking_handoff":
    case "seat_offer":
    case "seat_offer_commercial":
    case "trip_reminder_7d":
    case "trip_reminder_24h":
    case "trip_rescheduled":
    case "fly_safe_correction":
    case "trip_recap":
    case "trip_conditions_hold":
    case "trip_minimum_not_met":
    case "trip_blowout":
    case "booking_cancelled":
    case "party_payment_receipt":
    case "seat_already_held":
    case "party_not_booked":
    case "checkout_recovery":
    case "staff_reply":
    case "work_order_ready":
    case "gear_service_due":
    case "crew_schedule_change":
    case "departure_note":
    case "lost_item_found":
    case "course_certified":
    case "interest_received_ack":
    // The shore contact is asked, and later told, by the shop it agreed to
    // hear from (H-20261014-stale-roll-call-recipients).
    case "roll_call_stale_shore":
    // The bookkeeper hears from the shop that set their address (item 35).
    case "bookkeeper_month_end":
    case "bookkeeper_confirmation":
      return notification.shopName;
    case "welcome":
    case "password_reset_request":
    case "password_changed":
    case "staff_invite":
    case "operator_alert":
    case "setup_request_receipt":
    case "interest_received":
    case "weekly_digest":
    case "desk_after_hours":
    case "stripe_payments_restricted":
    case "move_ask_soon":
    case "roll_call_stale":
    case "incident_missing_diver":
    case "incident_missing_diver_found":
    case "shore_alert_stopped":
    case "bookkeeper_notice":
      return null;
  }
}

/**
 * Every character a header must never carry: C0 and C1 controls (a CR or LF
 * is a header injection), and the bidi overrides and isolates that would let a
 * shop name read as something else in a mail client's sender column.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const UNSAFE_IN_HEADER = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200e\u200f]/g;

/** Printable ASCII that needs no encoding inside an RFC 5322 quoted-string. */
const PLAIN_ASCII = /^[\x20-\x7e]*$/;

/** An RFC 2047 encoded-word may be at most 75 characters, `=?UTF-8?B?` and `?=` included. */
const ENCODED_WORD_MAX = 75;
const ENCODED_WORD_OVERHEAD = "=?UTF-8?B?".length + "?=".length;

/**
 * A display name a mail header can carry: a quoted-string when it is plain
 * ASCII, otherwise RFC 2047 base64 encoded-words (which SES requires for any
 * non-ASCII sender name). Split on whole characters, never mid-UTF-8 sequence,
 * so each word decodes on its own.
 */
export function encodeDisplayName(name: string): string {
  // Angle brackets too: inside a quoted name they are legal, but a parser that
  // reads the last `<…>` as the mailbox is the one a spoofed name aims at.
  const clean = name.replace(UNSAFE_IN_HEADER, "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  if (PLAIN_ASCII.test(clean)) return `"${clean.replace(/(["\\])/g, "\\$1")}"`;
  // Base64 turns 3 bytes into 4 characters, so a word holds this many bytes.
  const maxBytes = Math.floor((ENCODED_WORD_MAX - ENCODED_WORD_OVERHEAD) / 4) * 3;
  const words: string[] = [];
  let chunk = "";
  for (const char of clean) {
    if (Buffer.byteLength(chunk + char, "utf8") > maxBytes) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words
    .map((word) => `=?UTF-8?B?${Buffer.from(word, "utf8").toString("base64")}?=`)
    .join(" ");
}

/** `Name <address>` or a bare address, split into its two halves. */
function splitMailbox(value: string): { name: string | null; address: string } {
  const trimmed = value.trim();
  const open = trimmed.lastIndexOf("<");
  const close = trimmed.lastIndexOf(">");
  if (open === -1 || close < open) return { name: null, address: trimmed };
  const name = trimmed
    .slice(0, open)
    .trim()
    .replace(/^"(.*)"$/, "$1");
  return { name: name || null, address: trimmed.slice(open + 1, close).trim() };
}

/**
 * The `From` for one message: the configured sender unchanged when DiveDay is
 * the voice, and "{Shop} via {DiveDay's name}" on the same address when a shop
 * is. The configured display name is what follows "via", so a fork that set
 * `SES_FROM_EMAIL="Reef Ops <…>"` reads "Blue Mantis via Reef Ops".
 */
export function fromAddressFor(configuredFrom: string, notification: Notification): string {
  const shopName = shopVoiceOf(notification);
  if (!shopName) return configuredFrom;
  // A name held for review (issue #2450) is not given the From column: it
  // could pass for a brand or an institution, so the mail is plain DiveDay.
  if ("sender" in notification && notification.sender?.nameUnderReview) return configuredFrom;
  const { name, address } = splitMailbox(configuredFrom);
  const via = name ?? "DiveDay";
  return `${encodeDisplayName(`${shopName} via ${via}`)} <${address}>`;
}
