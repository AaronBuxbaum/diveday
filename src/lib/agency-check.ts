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
 * - The diver's first and last names sit on one line, in that order or as
 *   "Last, First", and the record that follows that line carries both the
 *   claimed level in that agency's own wording and the birth date or card
 *   number the lookup was typed with. Two people with one name are told apart
 *   by that, and a level from the next row is never read as theirs. A level
 *   named in the site's menus is nowhere near either.
 * - A birth date written all in numbers with the day and month both 12 or
 *   under is read in the agency's own order only (`dates`), so a transposed
 *   date is another diver's, never this one's.
 * - Words are compared whole, accent-free and case-free: "Ann" never matches
 *   "Joann", and "Zoë" matches "Zoe".
 * - A record that also says junior, referral, student, supervised, online,
 *   restricted and the like is never a match, and says so (`limited_card`).
 *   Those are limited or unfinished ratings. On a public lookup so is one
 *   that names a trainer's title (instructor, divemaster, leader): a staffer
 *   reads which row is whose.
 * - Divemaster and instructor never match, and are never checked
 *   (`isAgencyCheckableLevel`). Their names turn up in result rows as the
 *   *trainer's* title, and a professional rating is checked through the
 *   agency's own professional lookup, not this one.
 * - A higher rating's wording contains the lower one's ("Advanced Scuba
 *   Diver" contains "Scuba Diver"), so it matches the lower claim. A lower
 *   rating never matches a higher claim.
 * - **PADI DiveChek** (signed in, H-114) is narrower still, below
 *   (`ONE_RECORD_ONLY`): one diver, a record that ends at the first line that
 *   could be someone else's, the birth date before the level, and the card
 *   number too when the card has one.
 *
 * Everything short of a match leaves the card exactly as it was. "No record"
 * is never a failed check: CMAS says a missing result does not mean an invalid
 * card, and SDI says records from 2009 or earlier may be missing.
 */

/**
 * The agencies the extension checks, what each lookup form needs, and the
 * order the agency's page writes an all-numeric date in (`mdy` 04/12/1990,
 * `dmy` 12.04.1990), which settles a date whose day and month are both 12 or
 * under. One order per agency: a page that wrote the other one would read as
 * another birth date, which certifies nothing.
 */
export const AGENCY_CHECKS = {
  // Name and card number.
  ssi: { needs: "card_number", dates: "dmy" },
  // First name, last name, birth date.
  naui: { needs: "birth_date", dates: "mdy" },
  sdi: { needs: "birth_date", dates: "mdy" },
  // The number after the "#".
  gue: { needs: "card_number", dates: "mdy" },
  // A CMAS code, or names and birth date.
  cmas: { needs: "card_number_or_birth_date", dates: "dmy" },
  // DiveChek, on the PADI Pros' Site behind the shop's own sign-in: first
  // name, last name, birth date. A best guess until #2259's real-page test.
  padi: { needs: "birth_date", dates: "mdy" },
} as const satisfies Partial<
  Record<
    CertificationAgency,
    {
      needs: "card_number" | "birth_date" | "card_number_or_birth_date";
      dates: "mdy" | "dmy";
    }
  >
>;

export type CheckableAgency = keyof typeof AGENCY_CHECKS;

export function isCheckableAgency(agency: string): agency is CheckableAgency {
  return Object.hasOwn(AGENCY_CHECKS, agency);
}

/**
 * Whether a card at this level is one the extension checks. Divemaster and
 * instructor are not, at any agency: a professional rating is looked up on the
 * agency's professional tool, so a pending pro card keeps its link.
 */
export function isAgencyCheckableLevel(level: CertificationLevel): boolean {
  return level !== "divemaster" && level !== "instructor";
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
  // The query crosses to the extension and is typed into a third party's page,
  // so it carries only what this agency's form asks for: a birth date never
  // goes to a lookup by number, nor a number to a lookup by birth date. The
  // server re-derives the query to judge the page, so nothing is lost there.
  return {
    agency: input.agency,
    firstName: words[0] as string,
    lastName: words.at(-1) as string,
    birthDate: needs === "card_number" ? null : birthDate,
    cardNumber: needs === "birth_date" ? null : cardNumber,
  };
}

/**
 * Each agency's own words for each level it can certify here, before folding.
 * A level missing from an agency's row can never match for that agency.
 * Divemaster and instructor are absent everywhere on purpose (see above).
 * PADI's wording, at any level, is also what keeps a DiveChek record open
 * (`ONE_RECORD_ONLY`).
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
  // "Scuba Diver" alone is PADI's lesser rating, never Open Water.
  padi: {
    open_water: ["Open Water Diver"],
    advanced_open_water: ["Advanced Open Water Diver"],
    rescue: ["Rescue Diver"],
  },
};

/**
 * Agencies whose page must show exactly one diver. PADI's DiveChek is searched
 * with the shop's own sign-in and its result shape is a guess (#2259), so it is
 * read narrower than a public lookup:
 *
 * - **One diver, however many rows.** DiveChek may list one row per
 *   certification, so records are grouped by the birth date each carries:
 *   rows sharing the typed birth date are one diver's cards. A record naming
 *   the diver with another birth date is another diver, and two divers, or a
 *   line saying "2 divers" or more, is a list a staffer reads.
 * - **A record ends at the first line that could be someone else's**: a line
 *   naming the diver again, a line with neither a digit nor a rating's words
 *   (another diver's bare name), or a line carrying a date that is not the
 *   birth date and no rating's words (another diver's name and birth date).
 *   Never more than {@link RECORD_LINES} lines under the name, the same lines
 *   the extension hands back (`extension/fill.js`, `excerptAroundName`).
 * - **The birth date comes before the level**: on the name line or the line
 *   under it, and the level on that line or below.
 * - **The card number too**, when the card has one on file.
 * - **A trainer's title is not limiting** (a DiveChek row names the
 *   instructor who certified the card), and "Junior <level>" is the level for
 *   a diver 15 or older on the day of the check: PADI's junior ratings become
 *   the full rating at 15. Under 15 it is `junior_under_15`.
 */
const ONE_RECORD_ONLY: ReadonlySet<CheckableAgency> = new Set(["padi"]);

/**
 * A page saying it found more than one diver: "2 divers found". Only divers:
 * DiveChek may list one row per certification, so "3 results" or "3 records"
 * can be one diver's cards.
 */
const SEVERAL_DIVERS = /(^| )([2-9]|[1-9]\d+) divers?( |$)/;

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
] as const;

/**
 * A trainer's title in a public lookup's row: whose rating is whose is a
 * person's call. Not limiting on DiveChek, whose rows name the instructor.
 */
const TRAINER_WORDS = ["instructor", "divemaster", "leader", "assistant", "trainer"] as const;

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

/**
 * Lines under the diver's name line that can belong to their record. The
 * extension hands back the same number from a signed-in page (`AFTER` in
 * `extension/fill.js`); a test holds the two together.
 */
export const RECORD_LINES = 4;
/** The most of the agency's words kept as evidence on the card. */
export const EVIDENCE_MAX_LENGTH = 280;
/** The most page text the server reads. A results page is far smaller. */
export const PAGE_TEXT_MAX_LENGTH = 50_000;
/** PADI's junior ratings become the full rating on the diver's 15th birthday. */
export const JUNIOR_UPGRADE_AGE = 15;

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
  /** The diver is there, on a junior, limited or unfinished rating: a staffer looks. */
  | { verdict: "limited_card"; evidence: string }
  /** PADI shows a Junior rating and the diver is under 15: recorded by hand. */
  | { verdict: "junior_under_15"; evidence: string }
  /**
   * The page names someone by this name, never with the birth date or card
   * number typed. Another person: none of their words come back.
   */
  | { verdict: "namesake" }
  /** The agency says it found nobody. The card stays as it was. */
  | { verdict: "no_record" }
  /** The page lists several divers by this name (PADI): a staffer reads it. */
  | { verdict: "several_records" }
  /** The page did not read as a result either way. The card stays as it was. */
  | { verdict: "unreadable" };

const MONTH_NAMES = [
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
] as const;

function monthNumber(word: string): number | null {
  const index = MONTH_NAMES.findIndex(
    (name) =>
      word === name || word === name.slice(0, 3) || (name === "september" && word === "sept"),
  );
  return index === -1 ? null : index + 1;
}

/** Every date written on a folded line, in either of its spellings, as `YYYY-MM-DD`. */
const DATE_ON_LINE =
  /(?<![\p{L}\p{N}])(?:(\d{4}) (\d{1,2}) (\d{1,2})|(\d{1,2}) (\d{1,2}) (\d{4})|(\d{1,2}) ([a-z]+) (\d{4})|([a-z]+) (\d{1,2}) (\d{4}))(?![\p{L}\p{N}])/gu;

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The dates on a folded line. An all-numeric date whose day and month could
 * swap is read in the agency's order only; one that cannot (a day over 12) is
 * read the one way it can be.
 */
function datesOn(foldedLine: string, order: "mdy" | "dmy"): string[] {
  const dates: string[] = [];
  for (const m of foldedLine.matchAll(DATE_ON_LINE)) {
    let date: string | null = null;
    if (m[1]) {
      date = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    } else if (m[4]) {
      const a = Number(m[4]);
      const b = Number(m[5]);
      const year = Number(m[6]);
      if (a > 12) date = isoDate(year, b, a);
      else if (b > 12) date = isoDate(year, a, b);
      else date = order === "mdy" ? isoDate(year, a, b) : isoDate(year, b, a);
    } else if (m[7]) {
      const month = monthNumber(m[8] as string);
      date = month ? isoDate(Number(m[9]), month, Number(m[7])) : null;
    } else if (m[10]) {
      const month = monthNumber(m[10]);
      date = month ? isoDate(Number(m[12]), month, Number(m[11])) : null;
    }
    if (date) dates.push(date);
  }
  return dates;
}

function compact(text: string): string {
  return foldText(text).replace(/\s+/g, "");
}

function hasCardNumber(record: readonly string[], cardNumber: string | null): boolean {
  const number = cardNumber ? compact(cardNumber) : "";
  return number.length >= 3 && compact(record.join(" ")).includes(number);
}

/** Whole years old on a calendar date; both are `YYYY-MM-DD`. */
function ageOn(birthDate: string, today: string): number {
  const years = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return today.slice(5) >= birthDate.slice(5) ? years : years - 1;
}

/** How sure each verdict about one of this diver's records is: the best wins. */
const RECORD_RANK = {
  level_unconfirmed: 1,
  limited_card: 2,
  junior_under_15: 3,
  match: 4,
} as const;
type RecordVerdict = keyof typeof RECORD_RANK;

/**
 * Decide what an agency's results page says about one card. Pure: the same
 * text, card, diver and day always give the same verdict.
 *
 * `birthDate` and `cardNumber` are what the shop holds, whichever the lookup
 * typed: a PADI card's number is never typed into DiveChek, but the record
 * must carry it when the card has one. `today` is the day of the check
 * (`YYYY-MM-DD`), for a junior rating's age.
 */
export function judgeAgencyPage(input: {
  agency: CheckableAgency;
  level: CertificationLevel;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  cardNumber: string | null;
  today: string;
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
  const { needs, dates: order } = AGENCY_CHECKS[input.agency];
  const oneDiver = ONE_RECORD_ONLY.has(input.agency);
  const levelWords = LEVEL_WORDING[input.agency];
  const wording = (levelWords[input.level] ?? []).map(foldText);
  const everyLevelWording = Object.values(levelWords).flat().map(foldText);
  const limiting: readonly string[] = oneDiver
    ? LIMITING_WORDS
    : [...LIMITING_WORDS, ...TRAINER_WORDS];
  const saysNoRecord = (line: string) => NO_RECORD_WORDS.some((phrase) => hasWords(line, phrase));
  const ratingWords = (line: string) =>
    everyLevelWording.some((phrase) => hasWords(line, phrase)) ||
    limiting.some((word) => hasWords(line, word));

  // First and last on one line, in order with any middle names between, or
  // "Last, First": the comma is read before folding drops it.
  const forward = new RegExp(`(^| )${escapeRegExp(first)}( \\S+)* ${escapeRegExp(last)}( |$)`);
  const reversed = new RegExp(`(^| )${escapeRegExp(last)} ?, ?${escapeRegExp(first)}( |$)`);
  const commaFolded = rawLines.map((line) =>
    line
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}&,]+/gu, " ")
      .replace(/ ?, ?/g, " , ")
      .trim(),
  );
  const namesDiver = (index: number) =>
    forward.test(lines[index] as string) || reversed.test(commaFolded[index] as string);

  type PageRecord = { from: number; to: number; birthDateLine: number | null };
  const records: PageRecord[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!namesDiver(index)) continue;
    const ownDate = datesOn(lines[index] as string, order).length > 0;
    let to = index + 1;
    while (to < lines.length && to <= index + RECORD_LINES) {
      const line = lines[to] as string;
      if (saysNoRecord(line)) break;
      if (oneDiver) {
        if (namesDiver(to)) break;
        // The birth date's own line, right under a name line without one.
        const birthDateLine = to === index + 1 && !ownDate && datesOn(line, order).length > 0;
        if (!birthDateLine && !ratingWords(line)) {
          // Another diver's bare name, or their name and birth date.
          if (!/\d/.test(line) || datesOn(line, order).length > 0) break;
        }
      } else if (hasWords(line, last)) {
        break;
      }
      to += 1;
    }
    // A page that echoes the search ("Results for Jane Smith") above its own
    // "no results" has not found her.
    if (lines.slice(index, to).some(saysNoRecord) || saysNoRecord(lines[to] ?? "")) continue;
    const birthDateLine = ownDate
      ? index
      : index + 1 < to && datesOn(lines[index + 1] as string, order).length > 0
        ? index + 1
        : null;
    records.push({ from: index, to, birthDateLine });
  }

  /** The birth date a DiveChek record carries: the first date on its birth-date line. */
  const recordBirthDate = (record: PageRecord) =>
    record.birthDateLine === null
      ? null
      : (datesOn(lines[record.birthDateLine] as string, order)[0] ?? null);

  /** The record carries what the lookup was typed with, so it is this diver's. */
  const isThisDiver = (record: PageRecord): boolean => {
    const recordLines = lines.slice(record.from, record.to);
    if (oneDiver) return input.birthDate !== null && recordBirthDate(record) === input.birthDate;
    const hasNumber = hasCardNumber(recordLines, input.cardNumber);
    const hasBirthDate =
      input.birthDate !== null &&
      recordLines.some((line) => datesOn(line, order).includes(input.birthDate as string));
    if (needs === "card_number") return hasNumber;
    if (needs === "birth_date") return hasBirthDate;
    return hasNumber || hasBirthDate;
  };

  if (oneDiver && records.length > 0) {
    const divers = new Set(records.map(recordBirthDate).filter((date) => date !== null));
    if (divers.size > 1 || lines.some((line) => SEVERAL_DIVERS.test(line))) {
      return { verdict: "several_records" };
    }
  }

  const judgeRecord = (record: PageRecord): RecordVerdict => {
    const recordLines = lines.slice(record.from, record.to);
    // On DiveChek the level is read from the birth date's line down.
    const levelLines = oneDiver
      ? lines.slice(record.birthDateLine ?? record.to, record.to)
      : recordLines;
    const juniorLevel = (line: string) =>
      everyLevelWording.some((phrase) => hasWords(line, `junior ${phrase}`));
    const limited = recordLines.some((line) =>
      limiting.some(
        (word) => hasWords(line, word) && !(oneDiver && word === "junior" && juniorLevel(line)),
      ),
    );
    if (limited) return "limited_card";
    if (oneDiver && recordLines.some(juniorLevel)) {
      if (!input.birthDate || ageOn(input.birthDate, input.today) < JUNIOR_UPGRADE_AGE) {
        return "junior_under_15";
      }
    }
    if (!levelLines.some((line) => wording.some((phrase) => hasWords(line, phrase)))) {
      return "level_unconfirmed";
    }
    if (oneDiver && input.cardNumber && !hasCardNumber(recordLines, input.cardNumber)) {
      return "level_unconfirmed";
    }
    return "match";
  };

  let best: { verdict: RecordVerdict; evidence: string } | null = null;
  for (const record of records) {
    if (!isThisDiver(record)) continue;
    const verdict = judgeRecord(record);
    if (!best || RECORD_RANK[verdict] > RECORD_RANK[best.verdict]) {
      best = { verdict, evidence: evidence(rawLines.slice(record.from, record.to)) };
    }
    if (verdict === "match") break;
  }
  if (best) return best;
  // Someone by this name, never with this birth date or number: another
  // person, whose lines are not the shop's to keep.
  if (records.length > 0) return { verdict: "namesake" };
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
