import type { AgencyCheckResult } from "@/app/shop/[shopSlug]/divers/[personId]/card-actions";
import { fill } from "@/i18n/fill";
import type { AgencyCheckOutcome } from "@/lib/agency-check-queue";
import type { ExtensionFailureReason } from "@/lib/cert-check-extension";
import type { AgencyCheckCopy } from "./agency-check-copy";

/**
 * Why a check came back with no verdict, or null when it has one:
 * - `page`: the extension did not answer, or could not fill the agency's
 *   form. The staffer is told the agency's page could not be read.
 * - `signed_out`: a lookup behind the shop's own sign-in (PADI) met a sign-in
 *   page. The staffer is told to sign in first.
 * - `transport`: DiveDay's own server did not answer. The card may or may not
 *   have been written, so the staffer is told to reload and see.
 *
 * For the first two nothing was sent to the server and nothing was written.
 */
export type AgencyCheckFailure = "page" | "signed_out" | "transport" | null;

/** The extension's failure reason, as this check reads it. */
export function agencyCheckFailure(reason: ExtensionFailureReason): AgencyCheckFailure {
  return reason === "signed_out" ? "signed_out" : "page";
}

/**
 * **What one card's check came to**, read the same way wherever it was
 * pressed (H-105).
 */
export function agencyCheckOutcome(
  result: AgencyCheckResult,
  failure: AgencyCheckFailure,
): AgencyCheckOutcome | null {
  if (failure === "page") return "unreadable";
  if (failure) return failure;
  if (!result) return null;
  if (!result.ok) return "refused";
  if (result.verdict === "undone") return null;
  if (result.verdict === "match") return result.effect;
  return result.verdict;
}

/** What a match says: a pending card certified, or an imported one confirmed. */
export function agencyCheckMatchedText(
  result: Extract<AgencyCheckResult, { verdict: "match" }>,
  copy: Pick<AgencyCheckCopy, "matched" | "matchedConfirmed">,
): string {
  return result.effect === "confirmed" ? copy.matchedConfirmed : copy.matched;
}

/**
 * The sentence beside the card, or null when the card says it itself (a match
 * certifies it; an Undo puts it back). Anything short of a match is a warning
 * the staffer reads, with the link back to the agency's own page beside it.
 * `name` is the diver as the lookup typed them: a page that came back without
 * them is said as that diver's, not as the page's.
 */
export function agencyCheckOutcomeText(
  result: AgencyCheckResult,
  failure: AgencyCheckFailure,
  copy: AgencyCheckCopy,
  name: string,
): string | null {
  if (failure === "signed_out") return copy.signedOut;
  if (failure === "transport") return copy.noAnswer;
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
      return fill(copy.notFoundOnPage, { name });
    default:
      return null;
  }
}

/**
 * What the action is posted for one card: the card and the page's text,
 * nothing the browser decided. A "Check all" card adds `refresh=later`, so the
 * page repaints once when the run ends rather than after every card.
 */
export function agencyCheckForm(
  certificationId: string,
  pageText: string,
  options: { refreshLater?: boolean } = {},
): FormData {
  const formData = new FormData();
  formData.set("certificationId", certificationId);
  formData.set("pageText", pageText);
  if (options.refreshLater) formData.set("refresh", "later");
  return formData;
}
