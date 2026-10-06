import { BLOCKER_CATEGORY, type ReadinessBlocker } from "@/lib/readiness";

/**
 * Why a booking was attached to an existing diver on a guess (H-13): a reused
 * email under a different name, or a name a staffer picked off the counter's
 * "is this the same diver?" prompt. Mirrors the `identity_match_kind` pg enum.
 */
export type IdentityMatchKind = "shared_email" | "picked_name";

/**
 * **What a held seat says about itself** (dive-domain review 2026-10-05).
 *
 * While `identity_unconfirmed` stands, every other blocker readiness raised is
 * measured against the matched person's cards, release and date of birth:
 * facts about *somebody*, not provably about whoever is at the counter. Printed
 * under the held row they disclose the matched diver's state (a medical hold
 * under a stranger's booking), or, when the matched record is clean, make
 * "Same person" look like the only thing left. So a held seat says only the
 * identity question, what belongs to the seat itself (its payment), and the
 * two blockers about the *system* rather than any person: readiness could not
 * be worked out (`readiness_unavailable`) or the trip has no requirements set
 * (`requirements_not_configured`), which no answer to the identity question
 * would clear (security review 2026-10-06). The readiness result is
 * untouched: the seat is still blocked on all of it.
 */
export function heldSeatBlockers<T extends ReadinessBlocker>(blockers: readonly T[]): T[] {
  if (!blockers.some((blocker) => blocker.code === "identity_unconfirmed")) return [...blockers];
  return blockers.filter(
    (blocker) =>
      blocker.code === "identity_unconfirmed" ||
      blocker.code === "readiness_unavailable" ||
      blocker.code === "requirements_not_configured" ||
      BLOCKER_CATEGORY[blocker.code] === "payment",
  );
}
