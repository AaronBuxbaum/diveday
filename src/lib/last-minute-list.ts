import { randomBytes } from "node:crypto";
import { type CertificationLevel, certificationRank } from "./readiness";

/**
 * Fill-the-boat promo logic — matching last-minute-list entries to a
 * departing trip, and generating the code text a diver types at booking.
 * Framework-free (docs ADR 20260727-last-minute-fill-promos); the Stripe
 * coupon/promotion-code calls live in src/lib/payments/promotions.ts.
 */

export type LastMinuteListWindow = {
  /** Date-only (YYYY-MM-DD), or null for "no lower bound." */
  availableFrom: string | null;
  /** Date-only (YYYY-MM-DD), or null for "no upper bound." */
  availableUntil: string | null;
};

/**
 * True when a trip departing on `tripDateIso` (date-only, in the shop's own
 * timezone) falls inside the diver's stated window. Either bound absent means
 * unbounded on that side — a diver who gave no dates matches every trip.
 */
export function lastMinuteEntryMatchesTripDate(
  entry: LastMinuteListWindow,
  tripDateIso: string,
): boolean {
  if (entry.availableFrom && tripDateIso < entry.availableFrom) return false;
  if (entry.availableUntil && tripDateIso > entry.availableUntil) return false;
  return true;
}

/**
 * Puts a trip's own wait-listers first in a last-minute-deal recipient list,
 * longest wait first, ahead of everyone else who is merely around that week.
 * They asked about this exact trip and the deal can otherwise sell the seat
 * out from under them — see backlog item 147 (reconcile the wait list and the
 * last-minute list). Anyone not on the wait list keeps their original relative
 * order (a stable sort).
 *
 * This is the order one automated mail goes out in, and nothing more: a wait
 * list is a set of leads, not a queue anyone holds a place in
 * (ADR 20260813-wait-list-is-a-lead-list).
 */
export function orderLastMinuteRecipients<T extends { person: { id: string } }>(
  matches: readonly T[],
  waitlistedPersonIds: readonly string[],
): T[] {
  const position = new Map(waitlistedPersonIds.map((id, index) => [id, index]));
  return [...matches].sort((a, b) => {
    const aPos = position.get(a.person.id);
    const bPos = position.get(b.person.id);
    if (aPos !== undefined && bPos !== undefined) return aPos - bPos;
    if (aPos !== undefined) return -1;
    if (bPos !== undefined) return 1;
    return 0;
  });
}

/**
 * **How many of them the staff panel actually draws.** A real shop's list runs
 * to a couple of hundred people, and a `<ul>` that long inside the send form is
 * not a list anybody reads — it is a wall the Send button sits below.
 *
 * Ten, and then a count. The cap is safe *because* of the ordering below: the
 * people a staffer most needs to see are the ones it can never hide.
 */
export const LAST_MINUTE_RECIPIENT_PREVIEW_LIMIT = 10;

/** The one thing this fold reads off a recipient: what level, if any, is on file. */
export type LastMinuteRecipientLevel = {
  profile: { level: CertificationLevel | null } | null;
};

export type LastMinuteRecipientReview<T> = {
  /** The first `limit` recipients, risky ones first. */
  shown: T[];
  /** How many the cap left out — stated, never silently dropped. */
  hidden: number;
  total: number;
  /** Recipients whose level is on file and ranks below the trip's minimum. */
  below: number;
  /** Recipients with no level on file at all — the optional question, skipped. */
  notSaid: number;
};

function ranksBelow(
  recipient: LastMinuteRecipientLevel,
  requiredLevel: CertificationLevel | null,
): boolean {
  const level = recipient.profile?.level;
  if (!requiredLevel || !level) return false;
  return certificationRank(level) < certificationRank(requiredLevel);
}

/**
 * **What the staffer needs to know about this blast before they send it**, as
 * one fold: who to draw first, how many were left out, and the two counts the
 * summary sentence is made of.
 *
 * The ordering is the safeguard. Recipients arrive in the send's own order
 * (`orderLastMinuteRecipients` — this trip's wait-listers first), and that order
 * is preserved *within* each group, but anyone whose level ranks below the
 * trip's effective minimum is lifted to the top. Without that, a cap is a way
 * to hide exactly the names that should stop a send, which would make the panel
 * worse than the unbounded version it replaces.
 *
 * **Only the ladder is compared.** `requiredLevel` is the effective minimum
 * certification level — the trip's own bar folded with every dive site it
 * visits (`combineCertRequirements`). A required specialty or nitrox card is not
 * folded in: neither orders, so neither can say "below", and the recipient rows
 * carry nitrox on their own line. `null` means the departure demands no level,
 * and then nobody is below anything — never a fallback to some default rung.
 *
 * This informs and nothing else. Nothing here filters the blast, reorders the
 * mail, or gates the button (ADR 20260814-self-declared-cards): a declared level
 * is at best what a stranger typed about themselves on a marketing opt-in, and
 * the decision it feeds is a human's.
 */
export function reviewLastMinuteRecipients<T extends LastMinuteRecipientLevel>(
  recipients: readonly T[],
  requiredLevel: CertificationLevel | null,
  limit: number = LAST_MINUTE_RECIPIENT_PREVIEW_LIMIT,
): LastMinuteRecipientReview<T> {
  const below: T[] = [];
  const rest: T[] = [];
  let notSaid = 0;
  for (const recipient of recipients) {
    if (!recipient.profile?.level) notSaid += 1;
    if (ranksBelow(recipient, requiredLevel)) below.push(recipient);
    else rest.push(recipient);
  }
  const ordered = [...below, ...rest];
  const shown = ordered.slice(0, Math.max(limit, 0));
  return {
    shown,
    hidden: ordered.length - shown.length,
    total: recipients.length,
    below: below.length,
    notSaid,
  };
}

/** Discount bounds mirrored from the `trip_last_minute_promos_discount_range` check constraint. */
export const LAST_MINUTE_DISCOUNT_MIN = 5;
export const LAST_MINUTE_DISCOUNT_MAX = 90;

export function isValidLastMinuteDiscountPercent(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= LAST_MINUTE_DISCOUNT_MIN &&
    value <= LAST_MINUTE_DISCOUNT_MAX
  );
}

/**
 * A short, typeable code — "SAVE50-A1B2C3" — unique enough that a random
 * 6-hex-char suffix collision is astronomically unlikely; the shop-scoped
 * unique index is the actual backstop on retry. Uppercase only: Stripe
 * promotion codes are case-sensitive and divers reliably fat-finger case.
 */
export function generateLastMinutePromoCode(discountPercent: number): string {
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `SAVE${discountPercent}-${suffix}`;
}
