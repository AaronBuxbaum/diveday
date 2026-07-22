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

export type DiverChecklistItem = {
  category: ChecklistCategory;
  label: string;
  state: ChecklistState;
  /** One warm sentence in the diver's own language. */
  detail: string;
  /**
   * The worst blocker's code, so a transactional surface can offer the exact
   * action it enables (sign the waiver, pay the balance). Absent on a done item.
   */
  code?: ReadinessBlockerCode;
};

/**
 * Whether a blocker is on the diver ("action") or on the shop ("waiting").
 * Verification, review, and setup are the shop's to finish; signing, bringing a
 * card, and paying are the diver's. Kept honest so the page never nags a diver
 * about something only staff can clear.
 */
const DIVER_VOICE: Record<ReadinessBlockerCode, { state: "action" | "waiting"; detail: string }> = {
  requirements_not_configured: {
    state: "waiting",
    detail: "Your shop is still finalizing this trip’s details.",
  },
  readiness_unavailable: {
    state: "waiting",
    detail: "Your shop is confirming your readiness. Check back shortly.",
  },
  waiver_not_sent: {
    // A waiver goes out the moment a diver joins, so this state is the rare
    // leftover — a link that never issued (a delivery hiccup, or a waiver turned
    // on after booking). Stay honest: don't claim an email is coming; the shop
    // can hand over the link on arrival.
    state: "waiting",
    detail:
      "The shop hasn’t sent your waiver yet — you can ask for it when you arrive, or reach them below.",
  },
  waiver_pending: {
    // No email claim: in a no-email deployment the link was issued but never
    // sent, and on the readiness page the button hands it over in place.
    state: "action",
    detail: "Sign your waiver — it only takes about two minutes.",
  },
  waiver_expired: {
    // Don't promise an outbound send the shop may never make.
    state: "waiting",
    detail: "Your waiver link expired — ask the shop for a fresh one.",
  },
  medical_review: {
    state: "waiting",
    detail:
      "Thanks for signing. One medical answer needs a closer look — a doctor’s sign-off may be required, and your shop will be in touch about next steps.",
  },
  certification_missing: {
    state: "action",
    detail:
      "Get your certification card to the shop — upload a photo or get in touch — so they can add it to your file.",
  },
  certification_pending: {
    state: "waiting",
    detail: "Your certification card is with the shop for verification.",
  },
  certification_expired: {
    state: "action",
    detail:
      "Your certification on file has lapsed — check with your shop about a refresher or updated proof.",
  },
  certification_insufficient: {
    state: "action",
    detail: "This trip needs a higher certification level. Your shop can talk through the options.",
  },
  specialty_missing: {
    state: "action",
    detail:
      "This dive needs a specialty card — send the shop a photo or get in touch so they can add it.",
  },
  specialty_pending: {
    state: "waiting",
    detail: "Your specialty card is with the shop for verification.",
  },
  specialty_expired: {
    state: "action",
    detail: "Your specialty card on file has lapsed — check with your shop about updating it.",
  },
  nitrox_missing: {
    state: "action",
    detail:
      "This dive uses enriched air — send the shop a photo of your nitrox card or get in touch so they can add it.",
  },
  nitrox_pending: {
    state: "waiting",
    detail: "Your nitrox card is with the shop for verification.",
  },
  payment_due: {
    state: "action",
    detail: "There’s a balance to settle. Your shop can take payment before the trip.",
  },
};

const DONE_DETAIL: Record<Exclude<ChecklistCategory, "setup">, string> = {
  waiver: "Signed and on file.",
  certification: "Verified and on file.",
  payment: "Paid up — thank you.",
};

const CATEGORY_LABEL: Record<ChecklistCategory, string> = {
  waiver: "Waiver",
  certification: "Certification",
  payment: "Payment",
  setup: "Trip setup",
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
    if (
      DIVER_VOICE[blocker.code].state === "action" &&
      DIVER_VOICE[best.code].state === "waiting"
    ) {
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
        label: CATEGORY_LABEL.setup,
        state: "waiting",
        detail: blocker
          ? DIVER_VOICE[blocker.code].detail
          : "Your shop is still finalizing this trip’s details.",
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

  const items: DiverChecklistItem[] = [];
  for (const category of ["waiver", "certification", "payment"] as const) {
    if (!gated.has(category)) continue;
    const blockers = byCategory.get(category) ?? [];
    const blocker = worstBlocker(blockers);
    if (!blocker) {
      items.push({
        category,
        label: CATEGORY_LABEL[category],
        state: "done",
        detail: DONE_DETAIL[category],
      });
      continue;
    }
    const { state } = DIVER_VOICE[blocker.code];
    // A diver short several cards needs to know it's more than one thing — one
    // generic "share your card" line would leave them thinking a single card clears it.
    const actionable = blockers.filter((b) => DIVER_VOICE[b.code].state === "action").length;
    const detail =
      category === "certification" && actionable > 1
        ? "This dive needs more than one certification on file — share every card it calls for (a photo or a quick message works), and your shop will confirm you’re set."
        : DIVER_VOICE[blocker.code].detail;
    items.push({ category, label: CATEGORY_LABEL[category], state, detail, code: blocker.code });
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
 * Terse imperatives for a reminder — only the codes a diver can act on before
 * the dock. A "waiting" blocker (verification, medical review) is the shop's to
 * finish, so it never appears here as a to-do the diver can't complete.
 */
const REMINDER_ACTION: Partial<Record<ReadinessBlockerCode, string>> = {
  waiver_pending: "sign your waiver",
  certification_missing: "send your shop your certification card",
  certification_expired: "sort out your lapsed certification with the shop",
  certification_insufficient: "check your certification level with the shop",
  specialty_missing: "send your shop your specialty card",
  specialty_expired: "update your specialty card with the shop",
  nitrox_missing: "send your shop your nitrox card",
  payment_due: "settle your balance",
};

export type ReminderReadiness = {
  /** Short imperatives for what's still on the diver, e.g. "sign your waiver". */
  outstanding: string[];
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
  const outstanding: string[] = [];
  let medicalReview = false;
  for (const item of items) {
    if (item.code === "medical_review") medicalReview = true;
    const phrase = item.state === "action" && item.code ? REMINDER_ACTION[item.code] : undefined;
    if (phrase) outstanding.push(phrase);
  }
  return { outstanding, medicalReview };
}
