import type { TripRequirement } from "@/db/schema";
import {
  BLOCKER_CATEGORY,
  type BlockerCategory,
  type ReadinessBlocker,
  type ReadinessBlockerCode,
  type ReadinessResult,
} from "./readiness";

/**
 * The diver-facing half of the readiness engine. `readiness.ts` decides in
 * staff/safety language whether a diver can board; this turns that same result
 * into a calm, plain-language checklist a diver reads on their phone — what's
 * done, what's on them, and what the shop is handling. It never re-decides
 * readiness; it only re-voices the blockers the engine already produced.
 */

export type ChecklistState = "done" | "action" | "waiting";

/** Reuses the engine's canonical blocker families so no view can diverge. */
export type ChecklistCategory = BlockerCategory;

/**
 * Every distinct sentence the diver checklist can show. Most are a
 * `ReadinessBlockerCode` (the engine's own blocker, re-voiced for a diver —
 * see `src/i18n/readiness-summary-labels.ts`); the rest cover the "nothing
 * left in this category" and multi-card states that have no blocker of their
 * own.
 */
export type ChecklistDetailCode =
  | ReadinessBlockerCode
  | "waiver_done"
  | "certification_done"
  | "payment_done"
  | "certification_multiple_needed"
  | "setup_generic";

export type DiverChecklistItem = {
  category: ChecklistCategory;
  state: ChecklistState;
  /** Resolved to a sentence via `src/i18n/readiness-summary-labels.ts`, never here. */
  detailCode: ChecklistDetailCode;
  /**
   * The worst blocker's code, so a transactional surface can offer the exact
   * action it enables (sign the waiver, pay the balance). Absent on a done item.
   */
  code?: ReadinessBlockerCode;
  /**
   * **Every** blocker in this category that is on the diver, worst first —
   * because a category is one *line* but can be several *jobs*. A diver short a
   * level card, a Deep card and a nitrox card has one certification row and
   * three things to send, and `code` alone can only name the first: the
   * readiness page reads this to put an entry form under each one, rather than
   * clearing them one page-load at a time. Empty on a done item, and on a
   * category whose only blockers are the shop's to finish.
   */
  actionable: readonly ReadinessBlocker[];
};

/**
 * Whether a blocker is on the diver ("action") or on the shop ("waiting").
 * Verification, review, and setup are the shop's to finish; signing, bringing a
 * card, and paying are the diver's. Kept honest so the page never nags a diver
 * about something only staff can clear.
 */
const BLOCKER_STATE: Record<ReadinessBlockerCode, "action" | "waiting"> = {
  requirements_not_configured: "waiting",
  readiness_unavailable: "waiting",
  // Gentle and non-accusatory: this often just means a family sharing one
  // inbox. The shop clears it; there is nothing for the diver to do.
  identity_unconfirmed: "waiting",
  // Names the real reason (H-22, product-owner decision 2026-07-25). This
  // was word-for-word the `identity_unconfirmed` line until then, on the
  // reasoning that a `course_min_age` disclosure lets anyone who can guess
  // an email learn whether that email belongs to a child under a course's
  // minimum age (10/12/15/18) — the same oracle the public booking refusal
  // was pulled for, one step later.
  //
  // Naming it here is a *known, accepted* narrowing of that protection, not
  // a closure of it: `identity_unconfirmed` only flags a submitted name that
  // doesn't match the name already on file (H-13, `!nameMatches`), so an
  // attacker who already knows the child's real name — arguably the more
  // concerning, targeted case — gets `nameMatches: true` on the very first
  // request and never trips it. `buildDiverChecklist` picks the setup
  // bucket's *first* blocker, and `calculateReadiness` always pushes
  // `identity_unconfirmed` before `under_minimum_age` (src/lib/readiness.ts)
  // — so this copy is only ever shown when no identity mismatch is present,
  // and the mismatched-name case still gets the generic line above. The
  // known-name case does not. The product owner chose
  // this trade for the common case's clarity, with the gap written down
  // rather than silently accepted. See H-22, docs/product/human-decisions.md.
  under_minimum_age: "waiting",
  // A waiver goes out the moment a diver joins, so this state is the rare
  // leftover — a link that never issued (a delivery hiccup, or a waiver turned
  // on after booking). Stay honest: don't claim an email is coming; the shop
  // can hand over the link on arrival.
  waiver_not_sent: "waiting",
  // No email claim: in a no-email deployment the link was issued but never
  // sent, and on the readiness page the button hands it over in place.
  waiver_pending: "action",
  // "action", because the diver can clear this one themselves now: the
  // readiness page mints a fresh signing link on the spot, and the expired
  // waiver page mails one to the address on the booking. It read "waiting"
  // (and told the diver to go ask the shop) only while there was genuinely
  // nothing on this end for them to tap — a dead end for a link that ages out
  // in a week on a booking made months ahead.
  waiver_expired: "action",
  medical_review: "waiting",
  certification_missing: "action",
  certification_pending: "waiting",
  // "action", not "waiting": the diver said a level and nobody has seen a card,
  // so there is nothing on the shop's end to wait for — the card-entry form on
  // this very page is the whole fix, and it is offered for this code.
  certification_self_declared: "action",
  certification_expired: "action",
  certification_insufficient: "action",
  specialty_missing: "action",
  specialty_pending: "waiting",
  specialty_expired: "action",
  // "waiting", not "action": the card is on file and came across in the shop's
  // migration — there is nothing for the diver to send, only a staff confirm.
  specialty_import_unconfirmed: "waiting",
  nitrox_missing: "action",
  nitrox_pending: "waiting",
  nitrox_self_declared: "action",
  payment_due: "action",
  payment_refunded: "action",
};

/** The strongest blocker in a category wins the item's state and copy. */
function worstBlocker(blockers: readonly ReadinessBlocker[]): ReadinessBlocker | null {
  // "action" outranks "waiting" so the diver sees what's on them first.
  let best: ReadinessBlocker | null = null;
  for (const blocker of blockers) {
    if (!best) {
      best = blocker;
      continue;
    }
    if (BLOCKER_STATE[blocker.code] === "action" && BLOCKER_STATE[best.code] === "waiting") {
      best = blocker;
    }
  }
  return best;
}

/**
 * A short, ordered checklist a diver can read at a glance. A category appears
 * when the trip gates on it or when the readiness engine raised a blocker for it
 * (so a dive-site-composed cert gate is never dropped), each as one line. A
 * setup/unavailable blocker collapses the whole checklist to a single reassuring
 * line, because there is nothing the diver can act on until the shop finishes.
 */
export function buildDiverChecklist(
  requirement: TripRequirement | null,
  readiness: ReadinessResult,
): DiverChecklistItem[] {
  const byCategory = new Map<ChecklistCategory, ReadinessBlocker[]>();
  for (const blocker of readiness.blockers) {
    const category = BLOCKER_CATEGORY[blocker.code];
    const list = byCategory.get(category) ?? [];
    list.push(blocker);
    byCategory.set(category, list);
  }

  const setupBlockers = byCategory.get("setup");
  if (!requirement || setupBlockers) {
    const blocker = setupBlockers?.[0];
    return [
      {
        category: "setup",
        state: "waiting",
        detailCode: blocker ? blocker.code : "setup_generic",
        // Nothing here is the diver's to send — a setup blocker is the shop
        // finishing its own configuration.
        actionable: [],
      },
    ];
  }

  // Show a category when the trip gates on it OR when a blocker exists for it.
  // The readiness engine composes the dive *site's* cert/nitrox gate into the
  // result, so a trip whose own requirement leaves those fields blank can still
  // block on the site's rules. Surfacing on blocker-presence keeps the diver's
  // checklist honest instead of silently dropping a card they must bring.
  const gated = new Set<Exclude<ChecklistCategory, "setup">>();
  if (requirement.requiresWaiver) gated.add("waiver");
  if (
    requirement.minimumCertificationLevel ||
    (requirement.requiredSpecialties?.length ?? 0) > 0 ||
    requirement.requiresNitrox
  ) {
    gated.add("certification");
  }
  if (requirement.requiresPayment) gated.add("payment");
  for (const category of byCategory.keys()) {
    if (category !== "setup") gated.add(category);
  }

  const DONE_DETAIL_CODE: Record<Exclude<ChecklistCategory, "setup">, ChecklistDetailCode> = {
    waiver: "waiver_done",
    certification: "certification_done",
    payment: "payment_done",
  };

  const items: DiverChecklistItem[] = [];
  for (const category of ["waiver", "certification", "payment"] as const) {
    if (!gated.has(category)) continue;
    const blockers = byCategory.get(category) ?? [];
    const blocker = worstBlocker(blockers);
    if (!blocker) {
      items.push({
        category,
        state: "done",
        detailCode: DONE_DETAIL_CODE[category],
        actionable: [],
      });
      continue;
    }
    const state = BLOCKER_STATE[blocker.code];
    // A diver short several cards needs to know it's more than one thing — one
    // generic "share your card" line would leave them thinking a single card clears it.
    const actionable = blockers.filter((b) => BLOCKER_STATE[b.code] === "action");
    const detailCode: ChecklistDetailCode =
      category === "certification" && actionable.length > 1
        ? "certification_multiple_needed"
        : blocker.code;
    items.push({ category, state, detailCode, code: blocker.code, actionable });
  }
  return items;
}

/**
 * The one thing to do next, if anything is on the diver. Drives the "what's
 * next" line in confirmations and the diver page's headline. Returns null when
 * everything left is the shop's to finish (or nothing is left at all).
 */
export function nextDiverStep(items: readonly DiverChecklistItem[]): DiverChecklistItem | null {
  return items.find((item) => item.state === "action") ?? null;
}

/**
 * Only the codes a diver can act on before the dock — a "waiting" blocker
 * (verification, medical review) is the shop's to finish, so it never appears
 * here as a to-do the diver can't complete. A code, never a phrase: the
 * caller (`src/db/reminders.ts`'s SMS/email composition) resolves each one
 * through `src/i18n/reminder-labels.ts` against the recipient shop's locale
 * (docs ADR 20260731-notification-locale).
 *
 * The single source of truth for this set — `notificationSchema`
 * (`src/lib/notifications/index.ts`) derives its runtime-validated
 * `reminderActionCodeSchema` from this same array, so the type-level and
 * Zod-level lists can't drift apart.
 *
 * `waiver_expired` sits here alongside `waiver_pending` (product-owner
 * decision, 2026-08-03): a link that aged out on a booking made months ahead
 * leaves the diver exactly as unsigned as one that never arrived, so it earns
 * the same proactive cadence rather than silence until the dock. It is safe to
 * name here *because a reminder never carries a waiver token* — the only link
 * either channel sends is `readinessUrl`, a `readiness` capability minted fresh
 * at send time (`src/db/reminders.ts`), whose page mints a replacement signing
 * link on tap. Any future change that embeds a waiver link in a reminder must
 * reissue it first or drop this code again; mailing a diver the very link we
 * are telling them is dead is the failure mode this note exists to prevent.
 */
export const REMINDER_ACTION_CODES = [
  "waiver_pending",
  "waiver_expired",
  "certification_missing",
  "certification_expired",
  "certification_insufficient",
  // The two a diver now reaches the week before a dive with, since a stated
  // card buys the seat and the sighting is still owed (ADR
  // 20260820-attested-at-booking-verified-at-boarding). Without them the diver
  // this policy creates heard about the outstanding card once, on the
  // confirmation screen, and then got a week of reminders naming nothing —
  // a warm "see you Saturday" over the one item the whole design rests on
  // (`dive-domain-expert`, 2026-08-20).
  "certification_self_declared",
  "nitrox_self_declared",
  "specialty_missing",
  "specialty_expired",
  "nitrox_missing",
  "payment_due",
] as const;

export type ReminderActionCode = (typeof REMINDER_ACTION_CODES)[number];

const REMINDER_ACTIONABLE_CODES: ReadonlySet<ReminderActionCode> = new Set(REMINDER_ACTION_CODES);

function isReminderActionCode(code: ReadinessBlockerCode): code is ReminderActionCode {
  return REMINDER_ACTIONABLE_CODES.has(code as ReminderActionCode);
}

export type ReminderReadiness = {
  /** What's still on the diver, as codes — resolve via `reminderActionText`. */
  outstanding: ReminderActionCode[];
  /** True when a medical answer needs review — a doctor's sign-off may block boarding. */
  medicalReview: boolean;
};

/**
 * What a pre-trip reminder should name for one booking: the diver's own
 * outstanding actions and whether a medical answer is under review. Derived from
 * the same checklist the diver page shows, so the reminder never diverges from
 * what the engine decided. A fully-ready diver yields no items and no medical
 * flag, so the reminder stays a warm nudge instead of a false to-do.
 */
export function reminderReadiness(items: readonly DiverChecklistItem[]): ReminderReadiness {
  const outstanding: ReminderActionCode[] = [];
  let medicalReview = false;
  for (const item of items) {
    if (item.code === "medical_review") medicalReview = true;
    if (item.state === "action" && item.code && isReminderActionCode(item.code)) {
      outstanding.push(item.code);
    }
  }
  return { outstanding, medicalReview };
}
