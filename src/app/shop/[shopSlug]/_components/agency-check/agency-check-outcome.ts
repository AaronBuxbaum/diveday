import type { AgencyCheckResult } from "@/app/shop/[shopSlug]/divers/[personId]/card-actions";
import type { AgencyCheckOutcome } from "@/lib/agency-check-queue";
import type { ExtensionFailureReason } from "@/lib/cert-check-extension";
import type { AgencyCheckCopy } from "./agency-check-copy";

/**
 * Why the extension came back with no page to judge, or null when it did:
 * - `transport`: it did not answer, or could not fill the agency's form. The
 *   staffer is told the page could not be read, as for a captcha.
 * - `signed_out`: a lookup behind the shop's own sign-in (PADI) met a sign-in
 *   page. The staffer is told to sign in first.
 *
 * Either way nothing was sent to the server and nothing was written.
 */
export type AgencyCheckFailure = "transport" | "signed_out" | null;

/** The extension's failure reason, as this check reads it. */
export function agencyCheckFailure(reason: ExtensionFailureReason): AgencyCheckFailure {
  return reason === "signed_out" ? "signed_out" : "transport";
}

/**
 * **What one card's check came to**, read the same way wherever it was
 * pressed (H-105).
 */
export function agencyCheckOutcome(
  result: AgencyCheckResult,
  failure: AgencyCheckFailure,
): AgencyCheckOutcome | null {
  if (failure) return failure;
  if (!result) return null;
  if (!result.ok) return "refused";
  if (result.verdict === "undone") return null;
  return result.verdict;
}

/**
 * The sentence beside the card, or null when the card says it itself (a match
 * certifies it; an Undo puts it back). Anything short of a match is a warning
 * the staffer reads, with the link back to the agency's own page beside it.
 */
export function agencyCheckOutcomeText(
  result: AgencyCheckResult,
  failure: AgencyCheckFailure,
  copy: AgencyCheckCopy,
): string | null {
  if (failure === "signed_out") return copy.signedOut;
  if (failure) return copy.unreadable;
  if (!result) return null;
  if (!result.ok) return result.reason === "not-undoable" ? copy.undoFailed : copy.invalid;
  switch (result.verdict) {
    case "level_unconfirmed":
      return copy.levelUnconfirmed;
    case "no_record":
      return copy.noRecord;
    case "several_records":
      return copy.severalRecords;
    case "unreadable":
      return copy.unreadable;
    default:
      return null;
  }
}

/** What the action is posted for one card: the card and the page's text, nothing the browser decided. */
export function agencyCheckForm(certificationId: string, pageText: string): FormData {
  const formData = new FormData();
  formData.set("certificationId", certificationId);
  formData.set("pageText", pageText);
  return formData;
}
