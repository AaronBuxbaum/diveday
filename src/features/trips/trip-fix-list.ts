import { BLOCKER_CATEGORY, type ReadinessBlockerCode } from "@/lib/readiness";

/**
 * **The fix list** (ADR 20261117-trip-page-clock): what stands between a
 * trip's guests and the boat, in three groups. Pure, and built only from
 * readings the guest list already has: readiness blockers, and the advisory
 * reasons the roster rows say under a name.
 *
 * - `blocking` is exactly what boarding readiness refuses (a readiness
 *   blocker), no more and no less: an advisory never lands there and a
 *   blocker never hides in `worthAMinute`.
 * - `worthAMinute` is what holds nobody up but is worth a word: a desk task
 *   (an unsigned waiver the trip does not require, money, an emergency
 *   contact) or something the crew talks through (depth, a long gap since the
 *   last dive, a re-entry ask, a fit, an earlier physician's word).
 * - Everyone else is `fine`, folded into one line.
 *
 * Every item names one guest and carries all of that guest's reasons, so a
 * guest is on one line only and a group's count is a count of people.
 */

/** Every reason a roster row says that is not a readiness blocker. */
export const ADVISORY_REASONS = [
  "earlier_refusal",
  "earlier_referral",
  "more_holds",
  "waiver_unsigned",
  "payment_unpaid",
  "contact_missing",
  "re_entry_ask",
  "depth",
  "drysuit",
  "fit_needed",
  "recency",
  "help_requested",
] as const;
export type AdvisoryReason = (typeof ADVISORY_REASONS)[number];
export type FixReason = ReadinessBlockerCode | AdvisoryReason;

/** Every readiness blocker code, read off the one registry that lists them all. */
export const BLOCKER_REASONS = Object.keys(BLOCKER_CATEGORY) as ReadinessBlockerCode[];

/** The one remedy a reason calls for, as a door the page already has. */
export type FixRemedy =
  | "send_waiver"
  | "take_payment"
  | "review_cards"
  | "confirm_identity"
  | "review_medical"
  | "course_forms"
  | "add_contact"
  | "fit_gear"
  | "arrange_help"
  | "open";

/** Advisories the desk itself still owes once a guest has arrived. */
const DESK_ADVISORIES: ReadonlySet<FixReason> = new Set<FixReason>([
  "waiver_unsigned",
  "payment_unpaid",
  "contact_missing",
  // A diver asked for a hand: it stands until a crew member is on it.
  "help_requested",
]);

export function isBlockerReason(reason: FixReason): reason is ReadinessBlockerCode {
  return reason in BLOCKER_CATEGORY;
}

export function remedyFor(reason: FixReason): FixRemedy {
  switch (reason) {
    case "identity_unconfirmed":
    case "more_holds":
      return "confirm_identity";
    case "medical_review":
    case "medical_not_cleared":
    case "waiver_seal_failed":
    case "earlier_refusal":
    case "earlier_referral":
      return "review_medical";
    case "course_form_unsigned":
    case "course_form_guardian_missing":
      return "course_forms";
    case "waiver_unsigned":
      return "send_waiver";
    case "payment_unpaid":
    case "payment_due":
      return "take_payment";
    case "contact_missing":
      return "add_contact";
    case "fit_needed":
    case "drysuit":
      return "fit_gear";
    case "help_requested":
      return "arrange_help";
    case "re_entry_ask":
    case "depth":
    case "recency":
      return "open";
  }
  switch (BLOCKER_CATEGORY[reason]) {
    case "waiver":
      return "send_waiver";
    case "certification":
      return "review_cards";
    default:
      return "open";
  }
}

/**
 * The order a row names a guest’s reasons in, worst first: who they are before
 * anything measured against them, then a doctor's word, then paperwork, then
 * cards, then money.
 */
const PRIORITY: readonly FixReason[] = [
  "identity_unconfirmed",
  "more_holds",
  "medical_not_cleared",
  "medical_review",
  "waiver_seal_failed",
  "under_minimum_age",
  "waiver_not_sent",
  "waiver_pending",
  "waiver_lapsed",
  "waiver_runs_out",
  "guardian_signature_missing",
  "course_form_unsigned",
  "course_form_guardian_missing",
  "certification_missing",
  "certification_not_yet",
  "certification_insufficient",
  "certification_in_training",
  "certification_pending",
  "certification_self_declared",
  "specialty_missing",
  "specialty_pending",
  "specialty_import_unconfirmed",
  "nitrox_missing",
  "nitrox_pending",
  "nitrox_self_declared",
  "training_mark_invalid",
  "payment_due",
  "payment_refunded",
  "requirements_not_configured",
  "readiness_unavailable",
  // What the crew talks through before what the desk owes (domain review of
  // layer B, F1): a row names one reason, and once the guest is here only the
  // desk's own advisories stay, so a crew advisory ranked lower was never seen.
  "earlier_refusal",
  "earlier_referral",
  "help_requested",
  "depth",
  "recency",
  "re_entry_ask",
  "drysuit",
  "waiver_unsigned",
  "payment_unpaid",
  "contact_missing",
  "fit_needed",
];

export function reasonRank(reason: FixReason): number {
  const rank = PRIORITY.indexOf(reason);
  return rank === -1 ? PRIORITY.length : rank;
}

/** One guest as the list reads them. */
export type FixGuest = {
  id: string;
  /** Readiness blockers; empty when readiness clears the guest or has no reading. */
  blockers: readonly ReadinessBlockerCode[];
  advisories: readonly AdvisoryReason[];
  checkedIn: boolean;
  /** Released by the desk: not here, or seen and turned away. */
  released: "not_here" | "turned_away" | null;
};

/**
 * One guest's line: who, every reason that stands, worst first, and the remedy
 * the worst calls for. A guest has one line in the whole list (design review
 * of the final screens, finding 3): two guests who share a reason keep a line
 * each, so every count on the list counts people.
 */
export type FixItem = {
  guestId: string;
  /** Empty on a guest to come with nothing to say. */
  reasons: FixReason[];
  remedy: FixRemedy;
};

export type FixList = {
  blocking: FixItem[];
  worthAMinute: FixItem[];
  /** Check-in only: guests not here yet whom nothing holds up, each with its Check in. */
  toCome: FixItem[];
  /** Folded: at Check-in the guests here and done with, otherwise everyone fine. */
  fine: string[];
  notHere: string[];
  turnedAway: string[];
};

export type FixListMode = "checkin" | "all";

function itemOf(guestId: string, reasons: readonly FixReason[]): FixItem {
  const ordered = [...new Set(reasons)].sort((a, b) => reasonRank(a) - reasonRank(b));
  const worst = ordered[0];
  return { guestId, reasons: ordered, remedy: worst ? remedyFor(worst) : "open" };
}

export function fixListOf(guests: readonly FixGuest[], { mode }: { mode: FixListMode }): FixList {
  const list: FixList = {
    blocking: [],
    worthAMinute: [],
    toCome: [],
    fine: [],
    notHere: [],
    turnedAway: [],
  };
  for (const guest of guests) {
    if (guest.released === "not_here") {
      list.notHere.push(guest.id);
      continue;
    }
    if (guest.released === "turned_away") {
      list.turnedAway.push(guest.id);
      continue;
    }
    if (guest.blockers.length > 0) {
      list.blocking.push(itemOf(guest.id, guest.blockers));
      continue;
    }
    if (mode === "checkin" && !guest.checkedIn) {
      list.toCome.push(itemOf(guest.id, guest.advisories));
      continue;
    }
    // Once a guest is here, what the crew talks through has been talked
    // through at the desk; what the desk itself owes still stands.
    const advisories =
      mode === "checkin"
        ? guest.advisories.filter((reason) => DESK_ADVISORIES.has(reason))
        : guest.advisories;
    if (advisories.length > 0) list.worthAMinute.push(itemOf(guest.id, advisories));
    else list.fine.push(guest.id);
  }
  return list;
}
