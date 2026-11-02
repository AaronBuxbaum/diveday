import type { AgencyCheckResult } from "@/app/shop/[shopSlug]/divers/[personId]/agency-check-actions";
import { fill } from "@/i18n/fill";
import type { AgencyCheckOutcome } from "@/lib/agency-check-queue";
import type { ExtensionFailureReason } from "@/lib/cert-check-extension";
import type { AgencyCheckCopy } from "./agency-check-copy";

/**
 * Why a check came back with no verdict, or null when it has one:
 * - `page`: the extension did not answer, or could not fill the agency's
 *   form. The staffer is told the agency's page could not be read.
 * - `captcha`: the agency's page asks whether the staffer is human. They are
 *   told to open it and check there.
 * - `page_changed`: the agency's lookup page has no box or button where the
 *   lookup expects one. They are told it changed, and to check on its page.
 *   (Its shape goes to DiveDay's log, but a report may never arrive, so the
 *   sentence never says it did.)
 * - `unsupported`: this copy of the extension does not check the agency.
 *   They are told to update it, and to check on the agency's page.
 * - `signed_out`: a lookup behind the shop's own sign-in (PADI) met a sign-in
 *   page. The staffer is told to sign in first.
 * - `transport`: DiveDay's own server did not answer. The card may or may not
 *   have been written, so the staffer is told to reload and see.
 *
 * For all but the last nothing was judged and nothing was written; all but
 * `signed_out` and `transport` send the page's shape to DiveDay's log
 * (`reportFailedCheck`).
 */
export type AgencyCheckFailure =
  | "page"
  | "captcha"
  | "page_changed"
  | "manual_opened"
  | "unsupported"
  | "signed_out"
  | "transport"
  | null;

/** The extension's failure reason, as this check reads it. */
export function agencyCheckFailure(reason: ExtensionFailureReason): AgencyCheckFailure {
  if (
    reason === "signed_out" ||
    reason === "captcha" ||
    reason === "page_changed" ||
    reason === "manual_opened" ||
    reason === "unsupported"
  ) {
    return reason;
  }
  return "page";
}

/**
 * Whether the staffer's next step is the agency's own page: it answered short
 * of a match, or asked whether they are human, or has changed, or this copy
 * of the extension does not check it. Its link takes the button's place.
 */
export function agencyCheckSendsToAgency(
  result: AgencyCheckResult,
  failure: AgencyCheckFailure,
): boolean {
  return (
    failure === "captcha" ||
    failure === "page_changed" ||
    failure === "manual_opened" ||
    failure === "unsupported" ||
    agencyCheckAnswered(result)
  );
}

/**
 * **What one card's check came to**, read the same way wherever it was
 * pressed (H-20261008-cert-check-extension).
 */
export function agencyCheckOutcome(
  result: AgencyCheckResult,
  failure: AgencyCheckFailure,
): AgencyCheckOutcome | null {
  // A captcha, a changed page or an unchecked agency leaves that agency's
  // other cards in a "Check all"; an unreadable page counts toward two in a row.
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
  if (failure === "captcha") return copy.captcha;
  if (failure === "page_changed") return copy.pageChanged;
  if (failure === "manual_opened") return copy.manualOpened;
  if (failure === "unsupported") return copy.unsupported;
  if (failure === "transport") return copy.noAnswer;
  if (failure) return copy.unreadable;
  if (!result) return null;
  if (!result.ok) return result.reason === "not-undoable" ? copy.undoFailed : copy.invalid;
  switch (result.verdict) {
    case "level_unconfirmed":
      return result.listedCard ? copy.cardUnconfirmed : copy.levelUnconfirmed;
    case "limited_card":
      return copy.limitedCard;
    case "junior_under_15":
      return copy.juniorUnder15;
    case "namesake":
      return copy.namesake;
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
 * The agency's own words about this diver, shown under a result short of a
 * match: only ever this diver's record, never a namesake's.
 */
export function agencyCheckEvidence(result: AgencyCheckResult): string | null {
  return result?.ok === true && "evidence" in result ? result.evidence : null;
}

/**
 * Whether the agency's page answered, short of a match: the staffer's next
 * step is reading the agency's own page, so its link takes the button's place.
 */
export function agencyCheckAnswered(result: AgencyCheckResult): boolean {
  return result?.ok === true && result.verdict !== "match" && result.verdict !== "undone";
}

/**
 * What the action is posted for one card: the card and the page's text,
 * nothing the browser decided. A "Check all" card adds `refresh=later`, so the
 * page repaints once when the run ends rather than after every card.
 */
export function agencyCheckForm(
  certificationId: string,
  pageText: string,
  options: { refreshLater?: boolean; cardType?: "nitrox" | "specialty" } = {},
): FormData {
  const formData = new FormData();
  formData.set("certificationId", certificationId);
  // Which table the card is in; absent for a level card (issue #2592).
  if (options.cardType) formData.set("cardType", options.cardType);
  formData.set("pageText", pageText);
  if (options.refreshLater) formData.set("refresh", "later");
  return formData;
}
