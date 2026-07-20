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
    state: "waiting",
    detail: "Your waiver link is on its way from the shop.",
  },
  waiver_pending: {
    state: "action",
    detail:
      "Sign your waiver — the link is in your email from the shop. It takes about two minutes.",
  },
  waiver_expired: {
    state: "waiting",
    detail: "Your waiver link expired; the shop will send a fresh one.",
  },
  medical_review: {
    state: "waiting",
    detail:
      "Thanks for signing. A team member is privately reviewing one medical answer before the trip.",
  },
  certification_missing: {
    state: "action",
    detail: "Bring your certification card so the shop can add it to your file.",
  },
  certification_pending: {
    state: "waiting",
    detail: "Your certification card is with the shop for verification.",
  },
  certification_rejected: {
    state: "action",
    detail: "Your certification card needs another look — the shop will reach out.",
  },
  certification_expired: {
    state: "action",
    detail: "Your certification on file has expired; bring a current card.",
  },
  certification_insufficient: {
    state: "action",
    detail: "This trip needs a higher certification level. Your shop can talk through the options.",
  },
  specialty_missing: {
    state: "action",
    detail: "This dive needs a specialty card — bring it so the shop can add it.",
  },
  specialty_pending: {
    state: "waiting",
    detail: "Your specialty card is with the shop for verification.",
  },
  specialty_rejected: {
    state: "action",
    detail: "Your specialty card needs another look — the shop will reach out.",
  },
  specialty_expired: {
    state: "action",
    detail: "Your specialty card on file has expired; bring a current one.",
  },
  nitrox_missing: {
    state: "action",
    detail: "This dive uses enriched air — bring your nitrox card so the shop can add it.",
  },
  nitrox_pending: {
    state: "waiting",
    detail: "Your nitrox card is with the shop for verification.",
  },
  nitrox_rejected: {
    state: "action",
    detail: "Your nitrox card needs another look — the shop will reach out.",
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
 * A short, ordered checklist a diver can read at a glance. Only the categories
 * this trip actually requires appear, each as one line. A setup/unavailable
 * blocker collapses the whole checklist to a single reassuring line, because
 * there is nothing the diver can act on until the shop finishes.
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

  const items: DiverChecklistItem[] = [];
  const required: Exclude<ChecklistCategory, "setup">[] = [];
  if (requirement.requiresWaiver) required.push("waiver");
  if (
    requirement.minimumCertificationLevel ||
    (requirement.requiredSpecialties?.length ?? 0) > 0 ||
    requirement.requiresNitrox
  ) {
    required.push("certification");
  }
  if (requirement.requiresPayment) required.push("payment");

  for (const category of required) {
    const blocker = worstBlocker(byCategory.get(category) ?? []);
    if (!blocker) {
      items.push({
        category,
        label: CATEGORY_LABEL[category],
        state: "done",
        detail: DONE_DETAIL[category],
      });
      continue;
    }
    const { state, detail } = DIVER_VOICE[blocker.code];
    items.push({ category, label: CATEGORY_LABEL[category], state, detail });
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
