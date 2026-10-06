import type { IdentityMatchKind } from "@/lib/identity-match";
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
