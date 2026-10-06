import type { IdentityMatchKind } from "@/lib/identity-match";
import type { ReadinessBlocker } from "@/lib/readiness";
import { readinessBlockerText } from "./readiness-labels";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * The words of a held seat's two answers (`src/components/IdentityCheck.tsx`),
 * resolved once for the roster and the counter.
 */
export function identityCheckWords(t: StaffTranslator, recordName: string) {
  return {
    same: t("shared.identityCheck.same"),
    sameAria: t("shared.identityCheck.sameAria", { name: recordName }),
    different: t("shared.identityCheck.different"),
    newNameLabel: t("shared.identityCheck.newNameLabel"),
    dateOfBirthLabel: t("shared.identityCheck.dateOfBirthLabel"),
    emailLabel: t("shared.identityCheck.emailLabel"),
    phoneLabel: t("shared.identityCheck.phoneLabel"),
    optional: t("shared.identityCheck.optional"),
    split: t("shared.identityCheck.split"),
    splitting: t("shared.identityCheck.splitting"),
  };
}

/**
 * **The held seat's reason, naming both people** (Aaron, 2026-10-05: the old
 * sentence did not say what the issue was). "Booked as Hana Park with June
 * Park's email" is the whole question in one line, so the two answers under it
 * need no explanation of their own.
 *
 * A key and its values rather than words, so the diver record's status rows,
 * which carry codes, can hold it too. Null for a seat whose booked-as name was
 * never kept, where the generic blocker sentence stands.
 */
export function identityReasonMessage(
  claim: { bookedAs: string | null; matchedBy: IdentityMatchKind | null },
  recordName: string,
): { key: StaffMessageKey; values: Record<string, string> } | null {
  const { bookedAs, matchedBy } = claim;
  if (!bookedAs || !matchedBy) return null;
  if (bookedAs.trim().toLowerCase() === recordName.trim().toLowerCase()) {
    return { key: "shared.identityCheck.reasonSameName", values: { name: recordName } };
  }
  return {
    key:
      matchedBy === "shared_email"
        ? "shared.identityCheck.reasonSharedEmail"
        : "shared.identityCheck.reasonPickedName",
    values: { bookedAs, name: recordName },
  };
}

/** {@link identityReasonMessage} in words, or `fallback` (the blocker sentence). */
export function identityReasonText(
  t: StaffTranslator,
  claim: { bookedAs: string | null; matchedBy: IdentityMatchKind | null },
  recordName: string,
  fallback: string,
): string {
  const message = identityReasonMessage(claim, recordName);
  return message ? t(message.key, message.values) : fallback;
}

/**
 * **A blocker's sentence for the crew**: the boat manifest, its printed sheet
 * and the copy a crew phone saves (dive-domain review 2026-10-06).
 *
 * Every blocker reads as everywhere else but the identity question. On a held
 * seat that one says the seat is unconfirmed and that the *desk* settles it,
 * never "confirm who this is", which on a sheet at the rail tells the crew to
 * settle identity themselves; and when withholding dropped any other blocker
 * (`moreHoldsBehindConfirmation`), that other holds may still apply, without
 * saying which. "Confirm who this is" stays on the roster, where the confirm
 * control is.
 */
export function crewBlockerText(
  t: StaffTranslator,
  diver: { moreHoldsBehindConfirmation?: boolean },
  blocker: ReadinessBlocker,
): string {
  if (blocker.code !== "identity_unconfirmed") return readinessBlockerText(t, blocker);
  return t("manifest.heldSeatNotConfirmed", {
    moreHolds: diver.moreHoldsBehindConfirmation ? "yes" : "no",
  });
}
