import { AGENCY_KEYS } from "@/app/shop/[shopSlug]/divers/[personId]/_components/shared";
import type { CertificationAgency } from "@/db/schema";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { AGENCY_CHECKS, type CheckableAgency } from "@/lib/agency-check";
import { type AgencyVerificationPage, agencyVerificationPage } from "@/lib/agency-verification";

/**
 * **The agency check's words, once** (H-105): the diver record's card, a row
 * on a departure's Divers tab, a row on Today and a departure's "Check all"
 * all say the same thing about the same check, so they read it from here.
 * Server-side: the controls are Client Components and take these as props.
 */

/** Every word one card's check renders, translated with the agency's name in it. */
export type AgencyCheckCopy = {
  /** The button's words: "Check with SSI", "Check with PADI". */
  check: string;
  /**
   * The link's own words, back to the agency's page: the button's, except
   * that a member sign-in says so ("Check with PADI (member sign-in)").
   */
  link: string;
  checking: string;
  matched: string;
  levelUnconfirmed: string;
  noRecord: string;
  /** PADI listed more than one diver by this name. */
  severalRecords: string;
  unreadable: string;
  /** "Sign in to PADI first": a lookup behind the shop's sign-in met a sign-in page. */
  signedOut: string;
  invalid: string;
  undo: string;
  undoPending: string;
  undoFailed: string;
};

/** One agency's words, its name, and the page they fall back to. */
export type AgencyCheckAgencyCopy = AgencyCheckCopy & { agency: string; href: string };

/** The words a departure's "Check all" adds around the per-card ones. */
export type AgencyCheckAllCopy = {
  /** "Check all 9 with their agencies", counted on the server. */
  start: string;
  /** A template: `{done}` of `{total}`, while it runs (`fill`). */
  progress: string;
  /** A template: `{checked}` and `{certified}`, once it ran to the end. */
  finished: string;
  /** A template: `{name}` and `{agency}`, when a page could not be read. */
  stopped: string;
  /** A template: `{name}` and `{agency}`, when the staffer is not signed in to the agency. */
  stoppedSignedOut: string;
};

/**
 * What a check is called beside a card, by what the agency's far side is: a
 * portal with gaps is "searched", and a member sign-in is named before the
 * staffer meets the login form.
 */
const LINK_KEYS: Record<AgencyVerificationPage["kind"], StaffMessageKey> = {
  check: "divers.certifications.checkWithAgency",
  search_portal: "divers.certifications.searchAgencyPortal",
  member_sign_in: "divers.certifications.checkWithAgencyMemberSignIn",
};

/** The agency's link words ("Check with SSI"), or null for an agency with no page. */
export function agencyLinkLabel(
  t: StaffTranslator,
  agency: CertificationAgency,
): { label: string; href: string } | null {
  const page = agencyVerificationPage(agency);
  if (!page) return null;
  return { label: t(LINK_KEYS[page.kind], { agency: t(AGENCY_KEYS[agency]) }), href: page.url };
}

/**
 * One card's words, given the agency's link words. The button drops a member
 * sign-in's "(member sign-in)": with the extension, the staffer's own signed-in
 * browser does the lookup, and a signed-out one says so when it is pressed.
 */
export function agencyCheckCopy(
  t: StaffTranslator,
  agency: CertificationAgency,
  link: string,
): AgencyCheckCopy {
  const name = t(AGENCY_KEYS[agency]);
  const signIn = agencyVerificationPage(agency)?.kind === "member_sign_in";
  return {
    check: signIn ? t("divers.certifications.checkWithAgency", { agency: name }) : link,
    link,
    checking: t("divers.certifications.agencyCheck.checking", { agency: name }),
    matched: t("divers.certifications.agencyCheck.matched", { agency: name }),
    levelUnconfirmed: t("divers.certifications.agencyCheck.levelUnconfirmed", { agency: name }),
    noRecord: t("divers.certifications.agencyCheck.noRecord", { agency: name }),
    severalRecords: t("divers.certifications.agencyCheck.severalRecords", { agency: name }),
    unreadable: t("divers.certifications.agencyCheck.unreadable", { agency: name }),
    signedOut: t("divers.certifications.agencyCheck.signedOut", { agency: name }),
    invalid: t("divers.notices.invalid"),
    undo: t("shared.undoToast.undo"),
    undoPending: t("shared.undoToast.pendingLabel"),
    undoFailed: t("divers.notices.cardUndoFailed"),
  };
}

/** Every agency the extension checks, with its words: what a page of many divers' cards hands down. */
export function agencyCheckCopies(
  t: StaffTranslator,
): Record<CheckableAgency, AgencyCheckAgencyCopy> {
  const copies = {} as Record<CheckableAgency, AgencyCheckAgencyCopy>;
  for (const agency of Object.keys(AGENCY_CHECKS) as CheckableAgency[]) {
    const link = agencyLinkLabel(t, agency);
    // Every checkable agency has a page; the guard is for the type.
    if (!link) continue;
    copies[agency] = {
      ...agencyCheckCopy(t, agency, link.label),
      agency: t(AGENCY_KEYS[agency]),
      href: link.href,
    };
  }
  return copies;
}

/** The departure's "Check all" words: the count now, the running numbers in the browser. */
export function agencyCheckAllCopy(t: StaffTranslator, count: number): AgencyCheckAllCopy {
  return {
    start: t("trips.roster.agencyCheckAll.start", { count }),
    progress: t.raw("trips.roster.agencyCheckAll.progress"),
    finished: t.raw("trips.roster.agencyCheckAll.finished"),
    stopped: t.raw("trips.roster.agencyCheckAll.stopped"),
    stoppedSignedOut: t.raw("trips.roster.agencyCheckAll.stoppedSignedOut"),
  };
}
