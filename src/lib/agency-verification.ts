import type { CERTIFICATION_AGENCIES } from "@/lib/certification-options";

type CertificationAgency = (typeof CERTIFICATION_AGENCIES)[number];

/**
 * **Where a staffer checks a card with the agency that issued it.**
 *
 * H-10 (docs/product/human-decisions.md) dropped agency API integration because
 * no agency offers one: a shop looks the diver up in the agency's own portal
 * and marks the card sighted. This registry is the shortcut to that portal and
 * nothing more. The staff UI renders each entry as a plain link that opens the
 * agency's page in a new tab; DiveDay's servers never fetch, scrape or post to
 * any of these addresses, which is what keeps it inside H-10 (market audit
 * 2026-10-07, item 30). Since H-105 the DiveDay browser extension may open the
 * same page from the staffer's own browser and fill it in for them
 * (`src/lib/agency-check.ts`, `extension/agencies.js`, which must name the same
 * addresses).
 *
 * **Public pages, and one sign-in said out loud.** Every URL below answers
 * without a login except PADI's, and the link text says which kind each one
 * is (`kind`), so a staffer is never surprised by a login form or by an empty
 * result. Agencies left out, and why:
 *
 * - `raid`: diveraid.com links a "Search RAID Divers" page, but its search
 *   renders client side and could not be confirmed as a public diver lookup.
 * - `bsac`: no public qualification lookup; a member's record lives in the
 *   logged-in myBSAC app.
 * - `nss_cds`, `nacd`, `iantd`: no public card lookup found.
 * - `other`: not an agency.
 *
 * **No prefill.** None of these pages documents a query parameter that fills
 * its search box, so every link opens the bare form and the staffer types the
 * number (or the name and birth date) themselves. A guessed parameter that the
 * agency later renames would silently stop working; a bare link cannot.
 * `searchesBy` records what each form asks for, so a reader of this file (and
 * its test) knows why a name-and-birth-date agency still earns a link beside a
 * card number.
 *
 * Adding an agency here is a one-line change plus its test row; the link text
 * reuses the agency's existing name (`divers.shared.agencies.*`).
 */
export type AgencyVerificationPage = {
  /** The agency's own verification page. Always https, always the agency's domain. */
  url: string;
  /** What the agency's form searches by; informs the reader, never the UI. */
  searchesBy: "card_number" | "name_and_birth_date" | "card_number_or_name_and_birth_date";
  /**
   * What the link promises, and so which words it carries:
   * - `check`: a public lookup that answers for the agency ("Check with SSI").
   * - `search_portal`: a public search with known gaps, where not found does
   *   not mean invalid ("Search the CMAS portal").
   * - `member_sign_in`: the lookup sits behind the shop's own agency member
   *   login ("Check with PADI (member sign-in)").
   */
  kind: "check" | "search_portal" | "member_sign_in";
};

export const AGENCY_VERIFICATION_PAGES: Readonly<
  Partial<Record<CertificationAgency, AgencyVerificationPage>>
> = {
  // MySSI "Online Diver Check": the diver's name and certification number, or
  // the card's QR code. robots.txt keeps crawlers off my.divessi.com, so this
  // one was confirmed from three shop guides that link it as public rather
  // than by fetching it directly.
  ssi: {
    url: "https://my.divessi.com/online_diver_check",
    searchesBy: "card_number",
    kind: "check",
  },
  // NAUI "Verify Diver Certification": first name, last name, date of birth.
  naui: {
    url: "https://www.naui.org/services/verify-diver-certification/",
    searchesBy: "name_and_birth_date",
    kind: "check",
  },
  // SDI, TDI, ERDI and PFI share one "Certification Search": date of birth,
  // first name, last name.
  sdi: {
    url: "https://www.tdisdi.com/cert-search/",
    searchesBy: "name_and_birth_date",
    kind: "check",
  },
  tdi: {
    url: "https://www.tdisdi.com/cert-search/",
    searchesBy: "name_and_birth_date",
    kind: "check",
  },
  // The CMAS central portal: a CMAS code, or given name, family name and birth
  // date. The portal says a missing result does not mean an invalid card,
  // because national federations are still filling it, which is why the link
  // says "search" rather than "check" (glossary, "CMAS").
  cmas: {
    url: "https://portal.cmas.org/certifications",
    searchesBy: "card_number_or_name_and_birth_date",
    kind: "search_portal",
  },
  // GUE "Verify card": the number printed after the "#".
  gue: { url: "https://www.gue.com/verifycard", searchesBy: "card_number", kind: "check" },
  // PADI withdrew its public diver lookup "for privacy reasons". What remains
  // is DiveChek, under "Online Services" on the PADI Pros' Site, behind the
  // shop's PADI member login (PADI Pros' blog, "PADI ProChek and DiveChek
  // tools"). The link is the Pros' Site itself: DiveChek's own path renders
  // client side and could not be confirmed from outside a login, and a guessed
  // deep link that moves fails silently where the site's front door does not.
  // Pro Chek is a different tool and checks professionals, not divers.
  padi: {
    url: "https://pro.padi.com/",
    searchesBy: "card_number_or_name_and_birth_date",
    kind: "member_sign_in",
  },
};

/** The agency's verification page, or null when it publishes none. */
export function agencyVerificationPage(agency: CertificationAgency): AgencyVerificationPage | null {
  return AGENCY_VERIFICATION_PAGES[agency] ?? null;
}

/** The agency's verification page's address, or null when it publishes none. */
export function agencyVerificationUrl(agency: CertificationAgency): string | null {
  return agencyVerificationPage(agency)?.url ?? null;
}
