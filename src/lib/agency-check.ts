import type { CERTIFICATION_AGENCIES } from "@/lib/certification-options";

type CertificationAgency = (typeof CERTIFICATION_AGENCIES)[number];
type CertificationLevel =
  | "open_water"
  | "advanced_open_water"
  | "rescue"
  | "divemaster"
  | "instructor";

/**
 * **Reading an agency's lookup page, and deciding whether it certifies a card.**
 *
 * The DiveDay browser extension (`extension/`, H-105, ADR
 * 20261008-cert-check-extension) runs in the staffer's own browser. It opens
 * the agency's public lookup page (`src/lib/agency-verification.ts`), fills in
 * the diver's details, and hands back the text of the page that comes back.
 * Nothing in the extension decides anything: it carries words. This module is
 * where those words become a verdict, on the server, under tests.
 *
 * A **match** certifies the card without a second tap (H-105: Aaron chose
 * "auto"). That makes this the gate, so it is narrow on purpose:
 *
 * - The diver's first and last names and the claimed level's own wording, as
 *   that agency spells it, must sit in the same few lines of the page. A
 *   level named in the site's menus is nowhere near the diver's name.
 * - Words are compared whole, accent-free and case-free: "Ann" never matches
 *   "Joann", and "Zoë" matches "Zoe".
 * - A line that also says junior, referral, student, supervised and the like
 *   is never a match. Those are limited or unfinished ratings.
 * - Divemaster and instructor never match. Their names turn up in result rows
 *   as the *trainer's* title, and a professional rating is checked through the
 *   agency's own professional lookup, not this one.
 * - Only the claimed level counts. A page showing a higher rating than the
 *   card claims is still a "found the diver, not this level", for a staffer.
 *
 * Everything short of a match leaves the card exactly as it was. "No record"
 * is never a failed check: CMAS says a missing result does not mean an invalid
 * card, and SDI says records from 2009 or earlier may be missing.
 */

/** The agencies the extension checks, and what each lookup form needs. */
export const AGENCY_CHECKS = {
  // Name and card number.
  ssi: { needs: "card_number" },
  // First name, last name, birth date.
  naui: { needs: "birth_date" },
  sdi: { needs: "birth_date" },
  tdi: { needs: "birth_date" },
  // The number after the "#".
  gue: { needs: "card_number" },
  // A CMAS code, or names and birth date.
  cmas: { needs: "card_number_or_birth_date" },
} as const satisfies Partial<
  Record<CertificationAgency, { needs: "card_number" | "birth_date" | "card_number_or_birth_date" }>
>;

export type CheckableAgency = keyof typeof AGENCY_CHECKS;

export function isCheckableAgency(agency: string): agency is CheckableAgency {
  return Object.hasOwn(AGENCY_CHECKS, agency);
}

/** What the extension is asked to look up. Field names are the wire format. */
export type AgencyCheckQuery = {
  agency: CheckableAgency;
  firstName: string;
  lastName: string;
  /** `YYYY-MM-DD`, when the diver's record has one. */
  birthDate: string | null;
  cardNumber: string | null;
};

/**
 * The lookup for one card, or null when this agency cannot be checked or the
 * record lacks what its form asks for. A name with one word has no last name
 * to type, so it is not checked either.
 */
export function agencyCheckQuery(input: {
  agency: CertificationAgency;
  fullName: string;
  dateOfBirth: string | null;
  identifier: string | null;
}): AgencyCheckQuery | null {
  if (!isCheckableAgency(input.agency)) return null;
  const words = input.fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  const cardNumber = input.identifier?.trim() || null;
  const birthDate =
    input.dateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth) ? input.dateOfBirth : null;
  const needs = AGENCY_CHECKS[input.agency].needs;
  if (needs === "card_number" && !cardNumber) return null;
  if (needs === "birth_date" && !birthDate) return null;
  if (needs === "card_number_or_birth_date" && !cardNumber && !birthDate) return null;
  return {
    agency: input.agency,
    firstName: words[0] as string,
    lastName: words.at(-1) as string,
    birthDate,
    cardNumber,
  };
}

/**
 * Each agency's own words for each level it can certify here, before folding.
 * A level missing from an agency's row can never match for that agency.
 * Divemaster and instructor are absent everywhere on purpose (see above).
 */
const LEVEL_WORDING: Record<
  CheckableAgency,
  Partial<Record<CertificationLevel, readonly string[]>>
> = {
  ssi: {
    open_water: ["Open Water Diver"],
    advanced_open_water: ["Advanced Open Water Diver", "Advanced Adventurer"],
    rescue: ["Stress & Rescue", "Stress and Rescue", "Rescue Diver"],
  },
  naui: {
    open_water: ["Scuba Diver", "Open Water Diver"],
    advanced_open_water: ["Advanced Scuba Diver", "Advanced Open Water Diver"],
    rescue: ["Rescue Scuba Diver", "Rescue Diver"],
  },
  sdi: {
    open_water: ["Open Water Scuba Diver", "Open Water Diver"],
    advanced_open_water: ["Advanced Adventure Diver", "Advanced Diver"],
    rescue: ["Rescue Diver"],
  },
  tdi: {
    open_water: ["Open Water Scuba Diver", "Open Water Diver"],
    advanced_open_water: ["Advanced Adventure Diver", "Advanced Diver"],
    rescue: ["Rescue Diver"],
  },
  gue: {
    open_water: ["Recreational Diver 1", "Rec 1"],
  },
  cmas: {
    open_water: ["One Star Diver", "1 Star Diver", "1-Star Diver"],
    advanced_open_water: ["Two Star Diver", "2 Star Diver", "2-Star Diver"],
  },
};

/** Words that make a line a limited or unfinished rating, never a match. */
const LIMITING_WORDS = [
  "junior",
  "referral",
  "student",
  "trainee",
  "in training",
  "in progress",
  "incomplete",
  "supervised",
  "passport",
  "pending",
  "revoked",
  "suspended",
  "expired",
] as const;

/** How the agency's page says it found nobody. */
const NO_RECORD_WORDS = [
  "no results",
  "no result found",
  "no records",
  "no record found",
  "no certifications found",
  "no certification found",
  "no matching",
  "no diver found",
  "0 results",
  "could not find",
  "unable to find",
  "not found",
] as const;

/** Lines either side of the diver's last name that count as the same result. */
const RESULT_WINDOW = 3;
/** The most of the agency's words kept as evidence on the card. */
export const EVIDENCE_MAX_LENGTH = 280;
/** The most page text the server reads. A results page is far smaller. */
export const PAGE_TEXT_MAX_LENGTH = 50_000;

/** Lower case, no accents, every run of punctuation and space one space. */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&]+/gu, " ")
    .trim();
}

function hasWords(foldedLine: string, foldedPhrase: string): boolean {
  return foldedPhrase.length > 0 && ` ${foldedLine} `.includes(` ${foldedPhrase} `);
}

export type AgencyCheckVerdict =
  /** The diver, at this level: certify the card. */
  | { verdict: "match"; evidence: string }
  /** The diver is there, this level is not (or not cleanly): a staffer looks. */
  | { verdict: "level_unconfirmed"; evidence: string }
  /** The agency says it found nobody. The card stays as it was. */
  | { verdict: "no_record" }
  /** The page did not read as a result either way. The card stays as it was. */
  | { verdict: "unreadable" };

/**
 * Decide what an agency's results page says about one card. Pure: the same
 * text, card and diver always give the same verdict.
 */
export function judgeAgencyPage(input: {
  agency: CheckableAgency;
  level: CertificationLevel;
  firstName: string;
  lastName: string;
  pageText: string;
}): AgencyCheckVerdict {
  const rawLines = input.pageText
    .slice(0, PAGE_TEXT_MAX_LENGTH)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lines = rawLines.map(foldText);
  const first = foldText(input.firstName);
  const last = foldText(input.lastName);
  if (!first || !last) return { verdict: "unreadable" };
  const wording = (LEVEL_WORDING[input.agency][input.level] ?? []).map(foldText);

  let foundDiver: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (!hasWords(lines[index] as string, last)) continue;
    const from = Math.max(0, index - RESULT_WINDOW);
    const to = Math.min(lines.length, index + RESULT_WINDOW + 1);
    const window = lines.slice(from, to);
    if (!window.some((line) => hasWords(line, first))) continue;
    const evidenceLines = rawLines.slice(from, to);
    foundDiver ??= evidence(evidenceLines);
    // A page that echoes the search ("Results for Jane Smith") beside its own
    // "no results" has not found her, whatever else those lines say.
    if (window.some((line) => NO_RECORD_WORDS.some((phrase) => hasWords(line, phrase)))) continue;
    for (let offset = 0; offset < window.length; offset += 1) {
      const line = window[offset] as string;
      if (!wording.some((phrase) => hasWords(line, phrase))) continue;
      if (LIMITING_WORDS.some((word) => hasWords(line, word))) continue;
      return { verdict: "match", evidence: evidence(evidenceLines) };
    }
  }
  if (foundDiver) return { verdict: "level_unconfirmed", evidence: foundDiver };
  if (lines.some((line) => NO_RECORD_WORDS.some((phrase) => hasWords(line, phrase)))) {
    return { verdict: "no_record" };
  }
  return { verdict: "unreadable" };
}

function evidence(lines: readonly string[]): string {
  const joined = lines.join(" · ");
  return joined.length > EVIDENCE_MAX_LENGTH
    ? `${joined.slice(0, EVIDENCE_MAX_LENGTH - 1).trimEnd()}…`
    : joined;
}
