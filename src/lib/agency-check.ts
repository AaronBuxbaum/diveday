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
 * - The diver's first and last names sit on one line, in that order, and the
 *   record that follows that line (up to the next line naming them again)
 *   carries both the claimed level in that agency's own wording and the birth
 *   date or card number the lookup was typed with. Two people with one name
 *   are told apart by that, and a level from the next row is never read as
 *   theirs. A level named in the site's menus is nowhere near either.
 * - Words are compared whole, accent-free and case-free: "Ann" never matches
 *   "Joann", and "Zoë" matches "Zoe".
 * - A record that also says junior, referral, student, supervised, online,
 *   restricted and the like is never a match. Those are limited or unfinished
 *   ratings. So is one that names a trainer's title (instructor, divemaster,
 *   leader): a staffer reads which row is whose.
 * - Divemaster and instructor never match. Their names turn up in result rows
 *   as the *trainer's* title, and a professional rating is checked through the
 *   agency's own professional lookup, not this one.
 * - A higher rating's wording contains the lower one's ("Advanced Scuba
 *   Diver" contains "Scuba Diver"), so it matches the lower claim. A lower
 *   rating never matches a higher claim.

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
  // "Rec 1" alone is too short to trust: it is also inside "Rec 1 Instructor".
  gue: {
    open_water: ["Recreational Diver 1"],
  },
  cmas: {
    open_water: ["One Star Diver", "1 Star Diver", "1-Star Diver"],
    advanced_open_water: ["Two Star Diver", "2 Star Diver", "2-Star Diver"],
  },
};

/** Words that make a line a limited or unfinished rating, never a match. */
const LIMITING_WORDS = [
  // Limited, unfinished or lapsed ratings.
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
  "restricted",
  "limited",
  "provisional",
  "conditional",
  "invalid",
  "void",
  "cancelled",
  "canceled",
  "withdrawn",
  "inactive",
  "elearning",
  "online",
  "academic",
  // Try-dives.
  "discover",
  "try",
  "experience",
  "intro",
  // A trainer's title in the row: whose rating is whose is a person's call.
  "instructor",
  "divemaster",
  "leader",
  "assistant",
  "trainer",
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

/** Lines after the diver's name line that can belong to their record. */
const RECORD_LINES = 4;
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

/** The ways an agency's page might print a birth date, folded. */
function birthDateSpellings(iso: string): string[] {
  const [year, month, day] = iso.split("-") as [string, string, string];
  const m = String(Number(month));
  const d = String(Number(day));
  const names = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const name = names[Number(month) - 1] ?? "";
  const short = name.slice(0, 3);
  return [
    `${year} ${month} ${day}`,
    `${month} ${day} ${year}`,
    `${day} ${month} ${year}`,
    `${m} ${d} ${year}`,
    `${d} ${m} ${year}`,
    `${name} ${d} ${year}`,
    `${d} ${name} ${year}`,
    `${short} ${d} ${year}`,
    `${d} ${short} ${year}`,
  ];
}

function compact(text: string): string {
  return foldText(text).replace(/\s+/g, "");
}

/** The record carries what the lookup was typed with, so it is this diver's. */
function namesThisDiver(record: readonly string[], query: IdentityQuery): boolean {
  const folded = ` ${record.join(" ")} `;
  const number = query.cardNumber ? compact(query.cardNumber) : "";
  const hasNumber = number.length >= 3 && compact(record.join(" ")).includes(number);
  const hasBirthDate = query.birthDate
    ? birthDateSpellings(query.birthDate).some((spelling) => folded.includes(` ${spelling} `))
    : false;
  const needs = AGENCY_CHECKS[query.agency].needs;
  if (needs === "card_number") return hasNumber;
  if (needs === "birth_date") return hasBirthDate;
  return hasNumber || hasBirthDate;
}

type IdentityQuery = Pick<AgencyCheckQuery, "agency" | "birthDate" | "cardNumber">;

/**
 * Decide what an agency's results page says about one card. Pure: the same
 * text, card and diver always give the same verdict.
 */
export function judgeAgencyPage(input: {
  agency: CheckableAgency;
  level: CertificationLevel;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  cardNumber: string | null;
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
  const saysNoRecord = (line: string) => NO_RECORD_WORDS.some((phrase) => hasWords(line, phrase));
  // First and last on one line, in order, with any middle names between.
  const nameLine = new RegExp(`(^| )${escapeRegExp(first)}( \\S+)* ${escapeRegExp(last)}( |$)`);

  let foundDiver: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (!nameLine.test(lines[index] as string)) continue;
    let to = index + 1;
    while (
      to < lines.length &&
      to <= index + RECORD_LINES &&
      !hasWords(lines[to] as string, last) &&
      !saysNoRecord(lines[to] as string)
    ) {
      to += 1;
    }
    const record = lines.slice(index, to);
    // A page that echoes the search ("Results for Jane Smith") above its own
    // "no results" has not found her.
    if (record.some(saysNoRecord) || saysNoRecord(lines[to] ?? "")) continue;
    const recordEvidence = evidence(rawLines.slice(index, to));
    foundDiver ??= recordEvidence;
    if (!namesThisDiver(record, input)) continue;
    if (record.some((line) => LIMITING_WORDS.some((word) => hasWords(line, word)))) continue;
    if (!record.some((line) => wording.some((phrase) => hasWords(line, phrase)))) continue;
    return { verdict: "match", evidence: recordEvidence };
  }
  if (foundDiver) return { verdict: "level_unconfirmed", evidence: foundDiver };
  if (lines.some(saysNoRecord)) return { verdict: "no_record" };
  return { verdict: "unreadable" };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function evidence(lines: readonly string[]): string {
  const joined = lines.join(" · ");
  return joined.length > EVIDENCE_MAX_LENGTH
    ? `${joined.slice(0, EVIDENCE_MAX_LENGTH - 1).trimEnd()}…`
    : joined;
}
