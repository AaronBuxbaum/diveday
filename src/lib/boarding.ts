import type { TripRequirement } from "@/db/schema";
import { BLOCKER_CATEGORY, type ReadinessResult } from "./readiness";

/**
 * The staff side of the same readiness result: a compact "waiver ✓ / cert ✓ /
 * payment ✓" card the front desk eyeballs at the counter before boarding a
 * diver. It never re-decides readiness — it only projects the engine's blockers
 * onto the requirement categories this trip actually gates on, so a cleared
 * category reads as a tick and a blocked one carries the exact staff reason.
 */

export type BoardingCheck = {
  category: "waiver" | "certification" | "payment";
  label: string;
  ok: boolean;
  /** Staff-voice: a short "done" note when clear, the blocker reason when not. */
  detail: string;
};

const LABEL: Record<BoardingCheck["category"], string> = {
  waiver: "Waiver",
  certification: "Cards",
  payment: "Payment",
};

const DONE: Record<BoardingCheck["category"], string> = {
  waiver: "Signed",
  certification: "Verified",
  payment: "Settled",
};

/**
 * One row per gated requirement. Absent categories (a trip with no payment gate)
 * are simply not shown, so the card never implies a check that doesn't apply.
 */
export function buildBoardingChecks(
  requirement: TripRequirement | null,
  readiness: ReadinessResult,
): BoardingCheck[] {
  if (!requirement) return [];
  const messagesByCategory = new Map<BoardingCheck["category"], string>();
  for (const blocker of readiness.blockers) {
    const category = BLOCKER_CATEGORY[blocker.code];
    // "setup" isn't a per-diver check; it means the trip itself isn't configured.
    if (category === "setup") continue;
    if (!messagesByCategory.has(category)) messagesByCategory.set(category, blocker.message);
  }

  // Gate on the trip's own requirement OR on any blocker the engine raised, so a
  // dive-site-composed cert gate still shows a "Cards" row instead of silently
  // omitting it. (Boarding is fail-closed regardless — recordRollCall re-checks
  // readiness — but the card must not lie to the person at the counter.)
  const gated = new Set<BoardingCheck["category"]>();
  if (requirement.requiresWaiver) gated.add("waiver");
  if (
    requirement.minimumCertificationLevel ||
    (requirement.requiredSpecialties?.length ?? 0) > 0 ||
    requirement.requiresNitrox
  ) {
    gated.add("certification");
  }
  if (requirement.requiresPayment) gated.add("payment");
  for (const category of messagesByCategory.keys()) gated.add(category);

  return (["waiver", "certification", "payment"] as const)
    .filter((category) => gated.has(category))
    .map((category) => {
      const message = messagesByCategory.get(category);
      return {
        category,
        label: LABEL[category],
        ok: !message,
        detail: message ?? DONE[category],
      };
    });
}
