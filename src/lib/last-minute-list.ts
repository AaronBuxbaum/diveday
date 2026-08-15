import { randomBytes } from "node:crypto";
import {
  type CertificationLevel,
  type CertRequirementSource,
  certificationRank,
} from "./readiness";

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

/**
 * What this fold reads off a recipient: the level on file, if any, and whether
 * the diver said in so many words that they hold no card.
 *
 * The second field is not a redundant spelling of `level === null`. "Nothing on
 * file" is silence — an optional question skipped, which is most of a marketing
 * list — while "not certified yet" is an answer, and the two land a diver in
 * opposite places against a departure that asks for a level.
 */
export type LastMinuteRecipientLevel = {
  certification: {
    level: CertificationLevel | null;
    noCertificationDeclared: boolean;
  } | null;
};

/**
 * The departure's own gate: the trip's requirement folded with every dive site
 * it visits (`combineCertRequirements`), which is the same effective gate
 * admission and readiness enforce. Null when the trip has no requirements row
 * at all.
 *
 * The whole shape rather than the minimum level alone, because one recipient —
 * the joiner who says they hold no card — can be below a *card* requirement
 * that no level could ever be compared against.
 */
export type LastMinuteDepartureBar = CertRequirementSource;

/**
 * One drawn row: the recipient, and whether they rank **below this departure's
 * own bar**.
 *
 * The flag is returned rather than merely counted because the panel has to be
 * able to say it *on the row*. It could be recomputed there — the comparison is
 * two ranks — but then the ordering above and the words beside a name would be
 * two implementations of one question, free to disagree after any edit. A
 * verified Open Water diver on an Advanced departure is the case that made this
 * worth carrying: he is lifted to the top of the list and counted in the
 * summary, and until this flag existed his own row said nothing at all.
 *
 * False for every row when the departure asks for no level: there is no bar, so
 * nobody is under it.
 */
export type LastMinuteRecipientRow<T> = {
  recipient: T;
  belowRequirement: boolean;
};

export type LastMinuteRecipientReview<T> = {
  /** The first `limit` recipients, risky ones first, each with its own verdict. */
  shown: LastMinuteRecipientRow<T>[];
  /** How many the cap left out — stated, never silently dropped. */
  hidden: number;
  total: number;
  /**
   * Recipients below the trip's minimum: a level on file that ranks under it,
   * or a diver who said they hold no card at all.
   */
  below: number;
  /** Recipients who answered nothing — the optional question, skipped. */
  notSaid: number;
};

/**
 * Whether the departure asks for anything at all. Deliberately broader than
 * "has a minimum level": a Deep-and-nitrox charter with the level box left
 * blank is a common real configuration — the crew thinks about the site's card
 * requirement and never types a rung — and it is still a departure a diver can
 * fail to meet.
 */
function demandsAnything(requirement: LastMinuteDepartureBar | null): boolean {
  if (!requirement) return false;
  return (
    requirement.minimumCertificationLevel !== null ||
    requirement.requiredSpecialties.length > 0 ||
    requirement.requiresNitrox
  );
}

function ranksBelow(
  recipient: LastMinuteRecipientLevel,
  requirement: LastMinuteDepartureBar | null,
): boolean {
  const level = recipient.certification?.level;
  // **A stated "I hold no card" is below every bar there is**, and it is the
  // one case where saying so needs no ranking: an uncertified diver cannot be
  // ranked on a ladder they are not on, which is exactly why "none" is not a
  // rung (ADR 20260814-self-declared-cards). Without this the answer would be
  // *quieter* on this panel than an Open Water diver's card — lifted by
  // nothing, marked as nothing, and sitting below the ten-name cap.
  //
  // It is also the one verdict this fold can reach on a departure gated by
  // **cards rather than a rung**. Nothing else here can: a missing Deep card is
  // not knowable from a level, so the panel says in words that it cannot speak
  // to that — but "there is no card" needs no lookup to refute a Deep
  // requirement. A `dive-domain-expert` review found the answer silent on
  // exactly the departure a shop is most exposed on.
  //
  // Only while no level has landed beside it: the stamp is ignored rather than
  // deleted once one has, and the phrase on the row draws the level then too.
  if (!level) {
    return (
      recipient.certification?.noCertificationDeclared === true && demandsAnything(requirement)
    );
  }
  const requiredLevel = requirement?.minimumCertificationLevel ?? null;
  if (!requiredLevel) return false;
  return certificationRank(level) < certificationRank(requiredLevel);
}

/**
 * **What the staffer needs to know about this blast before they send it**, as
 * one fold: who to draw first, which of them is under the departure's bar, how
 * many were left out, and the two counts the summary sentence is made of.
 *
 * The ordering is the safeguard. Recipients arrive in the send's own order
 * (`orderLastMinuteRecipients` — this trip's wait-listers first), and that order
 * is preserved *within* each group, but anyone whose level ranks below the
 * trip's effective minimum is lifted to the top. Without that, a cap is a way
 * to hide exactly the names that should stop a send, which would make the panel
 * worse than the unbounded version it replaces.
 *
 * **Only the ladder is compared, for everybody who is on it.** `requirement` is
 * the departure's effective gate — its own bar folded with every dive site it
 * visits (`combineCertRequirements`). A required specialty or nitrox card does
 * not *order*, so it can never make one level "below" another, and the panel
 * says in words that it cannot speak to those cards.
 *
 * **The one recipient who is below without being on the ladder** is the joiner
 * who answered "I'm not certified yet". They are under any requirement a
 * departure sets — a rung, a specialty, or nitrox, since "there is no card"
 * refutes all three without a comparison — and they are lifted like anyone else
 * who is. What they are not is a rung, and nothing here compares them as one.
 * A departure that demands nothing has nobody below it, whatever they said.
 *
 * This informs and nothing else. Nothing here filters the blast, reorders the
 * mail, or gates the button (ADR 20260814-self-declared-cards): a declared level
 * is at best what a stranger typed about themselves on a marketing opt-in, and
 * the decision it feeds is a human's.
 */
export function reviewLastMinuteRecipients<T extends LastMinuteRecipientLevel>(
  recipients: readonly T[],
  requirement: LastMinuteDepartureBar | null,
  limit: number = LAST_MINUTE_RECIPIENT_PREVIEW_LIMIT,
): LastMinuteRecipientReview<T> {
  const below: LastMinuteRecipientRow<T>[] = [];
  const rest: LastMinuteRecipientRow<T>[] = [];
  let notSaid = 0;
  for (const recipient of recipients) {
    // Silence only. A joiner who answered "I'm not certified yet" said
    // something — counting them here would fold the answer back into the
    // ambiguity it was added to remove, and the sentence beneath the list would
    // go on describing them as people who never replied.
    if (!recipient.certification?.level && !recipient.certification?.noCertificationDeclared) {
      notSaid += 1;
    }
    // One evaluation of "is this person under the bar", feeding both the
    // ordering and the row's own words — never two.
    if (ranksBelow(recipient, requirement)) below.push({ recipient, belowRequirement: true });
    else rest.push({ recipient, belowRequirement: false });
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
