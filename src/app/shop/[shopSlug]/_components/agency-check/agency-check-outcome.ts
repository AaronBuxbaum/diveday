import type { AgencyCheckResult } from "@/app/shop/[shopSlug]/divers/[personId]/card-actions";
import type { AgencyCheckOutcome } from "@/lib/agency-check-queue";
import type { AgencyCheckCopy } from "./agency-check-copy";

/**
 * **What one card's check came to**, read the same way wherever it was
 * pressed (H-105). `transportFailed` is the extension not answering, or
 * answering that it could not fill the agency's form: the staffer is told the
 * page could not be read, as for a captcha, and nothing was written.
 */
export function agencyCheckOutcome(
  result: AgencyCheckResult,
  transportFailed: boolean,
): AgencyCheckOutcome | null {
  if (transportFailed) return "transport";
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
  transportFailed: boolean,
  copy: AgencyCheckCopy,
): string | null {
  if (transportFailed) return copy.unreadable;
  if (!result) return null;
  if (!result.ok) return result.reason === "not-undoable" ? copy.undoFailed : copy.invalid;
  switch (result.verdict) {
    case "level_unconfirmed":
      return copy.levelUnconfirmed;
    case "no_record":
      return copy.noRecord;
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
