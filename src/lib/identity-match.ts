import type { StaffMessageKey } from "@/i18n/staff-messages";
import { BLOCKER_CATEGORY, type ReadinessBlocker } from "@/lib/readiness";

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

/**
 * **The held seat's reason, naming both people** (Aaron, 2026-10-05: the old
 * sentence did not say what the issue was). "Booked as Hana Park, matched to
 * June Park" is the whole question in one line, so the two answers under it
 * need no explanation of their own.
 *
 * A key and its values rather than words, so the diver record's status rows,
 * which carry codes, can hold it too. Null for a seat whose booked-as name was
 * never kept, where the generic blocker sentence stands.
 */
export function identityReasonMessage(
  claim: { bookedAs: string | null },
  recordName: string,
): { key: StaffMessageKey; values: Record<string, string> } | null {
  const { bookedAs } = claim;
  if (!bookedAs) return null;
  if (bookedAs.trim().toLowerCase() === recordName.trim().toLowerCase()) {
    return { key: "shared.identityCheck.reasonSameName", values: { name: recordName } };
  }
  return {
    key: "shared.identityCheck.reasonPickedName",
    values: { bookedAs, name: recordName },
  };
}
