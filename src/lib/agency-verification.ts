import type { CERTIFICATION_AGENCIES } from "@/lib/certification-options";

type CertificationAgency = (typeof CERTIFICATION_AGENCIES)[number];

/**
 * **Where a staffer checks a card with the agency that issued it.**
 *
 * H-10 (docs/product/human-decisions.md) dropped agency API integration because
 * no agency offers one: a shop looks the diver up in the agency's own portal
 * and marks the card sighted. This registry is the shortcut to that portal and
 * nothing more. The staff UI renders each entry as a plain link that opens the
 * agency's page in a new tab; DiveDay never fetches, scrapes or posts to any of
 * these addresses, which is what keeps it inside H-10 (market audit
 * 2026-10-07, item 30).
 *
 * **Only public pages.** Every URL below was opened on 2026-10-07 and answers
 * without a login. Agencies left out, and why:
 *
 * - `padi`: PADI withdrew its public diver lookup "for privacy reasons". What
 *   remains is DiveChek on the PADI Pros' Site, behind a member login, and Pro
 *   Chek, which checks professionals rather than divers.
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
  /** The agency's own public verification page. Always https, always the agency's domain. */
  url: string;
  /** What the agency's form searches by; informs the reader, never the UI. */
  searchesBy: "card_number" | "name_and_birth_date" | "card_number_or_name_and_birth_date";
};

export const AGENCY_VERIFICATION_PAGES: Readonly<
  Partial<Record<CertificationAgency, AgencyVerificationPage>>
> = {
  // MySSI "Online Diver Check": the diver's name and certification number, or
  // the card's QR code. robots.txt keeps crawlers off my.divessi.com, so this
  // one was confirmed from three shop guides that link it as public rather
  // than by fetching it directly.
  ssi: { url: "https://my.divessi.com/online_diver_check", searchesBy: "card_number" },
  // NAUI "Verify Diver Certification": first name, last name, date of birth.
  naui: {
    url: "https://www.naui.org/services/verify-diver-certification/",
    searchesBy: "name_and_birth_date",
  },
  // SDI, TDI, ERDI and PFI share one "Certification Search": date of birth,
  // first name, last name.
  sdi: { url: "https://www.tdisdi.com/cert-search/", searchesBy: "name_and_birth_date" },
  tdi: { url: "https://www.tdisdi.com/cert-search/", searchesBy: "name_and_birth_date" },
  // The CMAS central portal: a CMAS code, or given name, family name and birth
  // date. The portal says a missing result does not mean an invalid card,
  // because national federations are still filling it.
  cmas: {
    url: "https://portal.cmas.org/certifications",
    searchesBy: "card_number_or_name_and_birth_date",
  },
  // GUE "Verify card": the number printed after the "#".
  gue: { url: "https://www.gue.com/verifycard", searchesBy: "card_number" },
};

/** The agency's public verification page, or null when it publishes none. */
export function agencyVerificationUrl(agency: CertificationAgency): string | null {
  return AGENCY_VERIFICATION_PAGES[agency]?.url ?? null;
}
