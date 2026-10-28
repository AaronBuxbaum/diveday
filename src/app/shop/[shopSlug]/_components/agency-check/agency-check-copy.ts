import { AGENCY_KEYS } from "@/app/shop/[shopSlug]/divers/[personId]/_components/shared";
import type { CertificationAgency } from "@/db/schema";
import { fill } from "@/i18n/fill";
import { SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import {
  AGENCY_CHECKS,
  type AgencyListedKind,
  type CheckableAgency,
  isCheckableAgency,
} from "@/lib/agency-check";
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
  /**
   * The button's words for a nitrox or specialty card, by kind (issue #2592):
   * "Check Nitrox with SSI", so a diver's two cards at one agency do not wear
   * the same button. A level card keeps `check`.
   */
  checkKind: Record<AgencyListedKind, string>;
  checking: string;
  /** A pending card certified. */
  matched: string;
  /** An imported card confirmed. */
  matchedConfirmed: string;
  levelUnconfirmed: string;
  /** A nitrox or specialty card: the diver is on the page, this certification is not. */
  cardUnconfirmed: string;
  /** The diver's record is junior, limited or unfinished. */
  limitedCard: string;
  /** PADI shows a junior rating, and the diver is under 15. */
  juniorUnder15: string;
  /** Someone by this name, never with the birth date or card number typed. */
  namesake: string;
  noRecord: string;
  /** PADI listed more than one diver by this name. */
  severalRecords: string;
  /** The agency's page could not be read at all (the extension came back without it). */
  unreadable: string;
  /** The agency's page asks whether the staffer is human: open it and check there. */
  captcha: string;
  /** The agency's lookup page is not the shape the extension knows. */
  pageChanged: string;
  manualOpened: string;
  /** This copy of the extension does not check the agency: update it. */
  unsupported: string;
  /** A template: `{name}`. The page came back, but did not show this diver cleanly. */
  notFoundOnPage: string;
  /** DiveDay's own server did not answer: reload to see where the card stands. */
  noAnswer: string;
  /** "Sign in to the PADI Pros’ Site first": a lookup behind the shop's sign-in met a sign-in page. */
  signedOut: string;
  invalid: string;
  undo: string;
  undoPending: string;
  dismiss: string;
  undoFailed: string;
  /** "PADI also shows these certifications. Add them?": the page's other cards, after a match. */
  listedLead: string;
  /** A template: `{name}`. The same, where the diver's row may have left the page (Today). */
  listedLeadFor: string;
  listedAdd: string;
  listedAdding: string;
  /** The ticked cards were filed, pending a staffer's Mark certified. */
  listedAdded: string;
  listedFailed: string;
};

/** One agency's words, its name, and the page they fall back to. */
export type AgencyCheckAgencyCopy = AgencyCheckCopy & { agency: string; href: string };

/** The words a departure's "Check all" adds around the per-card ones. */
export type AgencyCheckAllCopy = {
  /**
   * "Check all 9 cards with their agencies", by how many are left to check,
   * counted on the server: index N is the words for N cards. A re-run skips
   * the cards this page already settled, so the count can fall below the list.
   */
  start: readonly string[];
  /** The button that stops a running batch. */
  stop: string;
  /** A template: `{done}` of `{total}`, while it runs (`fill`). */
  progress: string;
  /** A template: `{checked}` and `{certified}`, once it ran to the end. */
  finished: string;
  /** A template: `{confirmed}`, added after `finished` or `cancelled` when imported cards were confirmed. */
  confirmed: string;
  /** A template: `{checked}` and `{certified}`, when the staffer stopped it. */
  cancelled: string;
  /** A template: `{name}` and `{agency}`, when two pages in a row could not be read. */
  stopped: string;
  /** A template: `{name}`, when DiveDay's own server did not answer. */
  stoppedTransport: string;
  /** A template: `{name}` and `{agency}`, when the staffer is not signed in to the agency. */
  stoppedSignedOut: string;
  /**
   * A template: `{agency}`, added once a run ends for each agency whose other
   * cards it left (a captcha, a changed page, an agency this copy does not check).
   */
  left: string;
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
  // What the agency was searched by, for "found this name, not this" and "found nobody".
  const identity = isCheckableAgency(agency) ? AGENCY_CHECKS[agency].needs : "birth_date";
  const kindNames: Record<AgencyListedKind, string> = {
    nitrox: t("shared.certificationSummary.nitrox"),
    deep: t(SPECIALTY_KEYS.deep),
    wreck: t(SPECIALTY_KEYS.wreck),
    night: t(SPECIALTY_KEYS.night),
    drysuit: t(SPECIALTY_KEYS.drysuit),
    cavern: t(SPECIALTY_KEYS.cavern),
  };
  const checkKind = {} as Record<AgencyListedKind, string>;
  for (const kind of Object.keys(kindNames) as AgencyListedKind[]) {
    checkKind[kind] = t("divers.certifications.agencyCheck.checkCard", {
      card: kindNames[kind],
      agency: name,
    });
  }
  return {
    check: signIn ? t("divers.certifications.checkWithAgency", { agency: name }) : link,
    checkKind,
    link,
    checking: t("divers.certifications.agencyCheck.checking", { agency: name }),
    manualOpened: t("divers.certifications.agencyCheck.manualOpened"),
    matched: t("divers.certifications.agencyCheck.matched", { agency: name }),
    matchedConfirmed: t("divers.certifications.agencyCheck.matchedConfirmed", { agency: name }),
    levelUnconfirmed: t("divers.certifications.agencyCheck.levelUnconfirmed", { agency: name }),
    cardUnconfirmed: t("divers.certifications.agencyCheck.cardUnconfirmed", { agency: name }),
    limitedCard: t("divers.certifications.agencyCheck.limitedCard", { agency: name }),
    juniorUnder15: t("divers.certifications.agencyCheck.juniorUnder15", { agency: name }),
    namesake: t("divers.certifications.agencyCheck.namesake", { agency: name, identity }),
    // The CMAS portal is filled in federation by federation: a gap there is
    // not a sign the card is wrong.
    noRecord:
      agency === "cmas"
        ? t("divers.certifications.agencyCheck.noRecordCmas")
        : t("divers.certifications.agencyCheck.noRecord", { agency: name, identity }),
    severalRecords: t("divers.certifications.agencyCheck.severalRecords", { agency: name }),
    unreadable: t("divers.certifications.agencyCheck.unreadable", { agency: name }),
    captcha: t("divers.certifications.agencyCheck.captcha", { agency: name }),
    pageChanged: t("divers.certifications.agencyCheck.pageChanged", { agency: name }),
    unsupported: t("divers.certifications.agencyCheck.unsupported", { agency: name }),
    // The agency now, the diver in the browser: one host holds many divers.
    notFoundOnPage: fill(t.raw("divers.certifications.agencyCheck.notFoundOnPage"), {
      agency: name,
    }),
    noAnswer: t("divers.certifications.agencyCheck.noAnswer"),
    signedOut: t("divers.certifications.agencyCheck.signedOut", { agency: name }),
    invalid: t("divers.notices.invalid"),
    undo: t("shared.undoToast.undo"),
    undoPending: t("shared.undoToast.pendingLabel"),
    dismiss: t("shared.undoToast.dismiss"),
    undoFailed: t("divers.notices.cardUndoFailed"),
    listedLead: t("divers.certifications.agencyCheck.listed.lead", { agency: name }),
    listedLeadFor: fill(t.raw("divers.certifications.agencyCheck.listed.leadFor"), {
      agency: name,
    }),
    listedAdd: t("divers.certifications.agencyCheck.listed.add"),
    listedAdding: t("divers.certifications.agencyCheck.listed.adding"),
    listedAdded: t("divers.certifications.agencyCheck.listed.added"),
    listedFailed: t("divers.certifications.agencyCheck.listed.failed"),
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

/** The departure's "Check all" words: the counts now, the running numbers in the browser. */
export function agencyCheckAllCopy(t: StaffTranslator, count: number): AgencyCheckAllCopy {
  return {
    start: Array.from({ length: count + 1 }, (_, each) =>
      t("trips.roster.agencyCheckAll.start", { count: each }),
    ),
    stop: t("trips.roster.agencyCheckAll.stop"),
    progress: t.raw("trips.roster.agencyCheckAll.progress"),
    finished: t.raw("trips.roster.agencyCheckAll.finished"),
    confirmed: t.raw("trips.roster.agencyCheckAll.confirmed"),
    cancelled: t.raw("trips.roster.agencyCheckAll.cancelled"),
    stopped: t.raw("trips.roster.agencyCheckAll.stopped"),
    stoppedTransport: t.raw("trips.roster.agencyCheckAll.stoppedTransport"),
    stoppedSignedOut: t.raw("trips.roster.agencyCheckAll.stoppedSignedOut"),
    left: t.raw("trips.roster.agencyCheckAll.left"),
  };
}
