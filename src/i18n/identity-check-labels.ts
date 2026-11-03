import { type IdentityMatchKind, identityReasonMessage } from "@/lib/identity-match";
import type { ReadinessBlocker } from "@/lib/readiness";
import { readinessBlockerText } from "./readiness-labels";
import type { StaffTranslator } from "./staff-messages";

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
    adultAttested: t("shared.identityCheck.adultAttested"),
    split: t("shared.identityCheck.split"),
    splitting: t("shared.identityCheck.splitting"),
    another: t("shared.identityCheck.another"),
    anotherLegend: t("shared.identityCheck.anotherLegend"),
    anotherNote: t("shared.identityCheck.anotherNote"),
    openRecord: t("shared.identityCheck.openRecord"),
    repoint: t("shared.identityCheck.repoint"),
    repointing: t("shared.identityCheck.repointing"),
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
