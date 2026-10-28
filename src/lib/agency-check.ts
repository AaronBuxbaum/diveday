import type { DiveSpecialty } from "@/db/schema";
import { JUNIOR_AGE_END } from "@/lib/age";
import { MIN_CARD_NUMBER_LENGTH } from "@/lib/card-number";
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
 *   named in the site's menus is nowhere near either. A name split over two
 *   adjacent labelled lines ("First name: Lena" over "Last name: Ortiz") is
 *   read as one name line (`splitName`), and nothing looser is.
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
 * - **PADI DiveChek** (signed in, H-121) is narrower still, below
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
 *
 * `numbersTheDiver` says whether the agency gives the diver one number that
 * every card they hold carries (the glossary's **C-card**), so a card the
 * page lists may borrow the checked card's number. SDI and CMAS number each
 * card: a listed card there takes the number printed on its own line, or none
 * and the card sighting (`agencyListedCards`).
 */
export const AGENCY_CHECKS = {
  // Name and card number.
  ssi: { needs: "card_number", dates: "dmy", numbersTheDiver: true },
  // First name, last name, birth date.
  naui: { needs: "birth_date", dates: "mdy", numbersTheDiver: true },
  sdi: { needs: "birth_date", dates: "mdy", numbersTheDiver: false },
  // The number after the "#".
  gue: { needs: "card_number", dates: "mdy", numbersTheDiver: true },
  // A CMAS code, or names and birth date.
  cmas: { needs: "card_number_or_birth_date", dates: "dmy", numbersTheDiver: false },
  // DiveChek, on the PADI Pros' Site behind the shop's own sign-in: first
  // name, last name, birth date. A best guess until #2259's real-page test.
  padi: { needs: "birth_date", dates: "mdy", numbersTheDiver: true },
} as const satisfies Partial<
  Record<
    CertificationAgency,
    {
      needs: "card_number" | "birth_date" | "card_number_or_birth_date";
      dates: "mdy" | "dmy";
      numbersTheDiver: boolean;
    }
  >
>;

export type CheckableAgency = keyof typeof AGENCY_CHECKS;

export function isCheckableAgency(agency: string): agency is CheckableAgency {
  return Object.hasOwn(AGENCY_CHECKS, agency);
}

/**
 * Whether this shop is offered the extension's check for this agency. PADI's
 * checks (DiveChek here, eLearning in `elearning-check.ts`) run in a staffer's
 * browser signed in under the shop's own PADI membership, behind the shop's
 * own switch (`shops.padi_checks_enabled`, H-121), on for a new shop since
 * 2026-10-23. Off, a PADI card keeps its "(member sign-in)" link and nothing
 * offers or accepts a check.
 */
export function agencyCheckOffered(agency: string, shop: { padiChecksEnabled: boolean }): boolean {
  // A course's agency is free text: "PADI" and " padi " are PADI.
  return foldText(agency) !== "padi" || shop.padiChecksEnabled;
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
  if (words.length === 0 || (words.length < 2 && input.agency !== "ssi")) return null;
  const cardNumber = input.identifier?.trim() || null;
  const birthDate =
    input.dateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth) ? input.dateOfBirth : null;
  const needs = AGENCY_CHECKS[input.agency].needs;
  if (needs === "card_number" && !cardNumber && input.agency !== "ssi") return null;
  if (needs === "birth_date" && !birthDate) return null;
  if (needs === "card_number_or_birth_date" && !cardNumber && !birthDate) return null;
  // The query crosses to the extension and is typed into a third party's page,
  // so it carries only what this agency's form asks for. SSI's manual form
  // takes the known birth date, while its automatic verdict still needs the
  // card number. Other number lookups do not receive a birth date. The
  // server re-derives the query to judge the page, so nothing is lost there.
  return {
    agency: input.agency,
    firstName: words[0] as string,
    lastName: words.length > 1 ? (words.at(-1) as string) : "",
    birthDate: needs === "card_number" && input.agency !== "ssi" ? null : birthDate,
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
export const LEVEL_WORDING: Record<
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
 * **The other cards an agency's page may list for this diver**, in that
 * agency's own words, mapped to DiveDay's own card kinds: nitrox and the
 * specialties a site or trip can require (`dive_specialty`). A closed table:
 * wording that is not here is ignored, never guessed, so a "Tec Deep Diver",
 * an "Advanced Nitrox Diver" or a "Deep Diver Specialty Instructor" is not
 * read as the recreational card it contains (`agencyListedCards`). An agency
 * missing a kind is never offered it. GUE lists no nitrox card of its own: its
 * enriched air comes bundled in the level card (`BUNDLED_NITROX`).
 *
 * Levels are not here. A level card's number is the agency's number for the
 * diver, unique per agency at a shop, so a second level card for the same
 * diver and agency cannot be filed beside the one just checked; a higher
 * rating on the page is the staffer's to record.
 */
export type AgencyListedKind = "nitrox" | DiveSpecialty;

export const LISTED_CARD_WORDING: Record<
  CheckableAgency,
  Partial<Record<AgencyListedKind, readonly string[]>>
> = {
  // SSI's nitrox card is "Enriched Air Nitrox"; a mix written after it is a
  // number on the line, read as one.
  ssi: {
    nitrox: ["Enriched Air Nitrox"],
    deep: ["Deep Diving"],
    wreck: ["Wreck Diving"],
    night: ["Night & Limited Visibility Diving", "Night and Limited Visibility Diving"],
    drysuit: ["Dry Suit Diving"],
  },
  // "Wreck Penetration" is a technical card and is not here.
  naui: {
    nitrox: ["Enriched Air Nitrox Diver", "Enriched Air Nitrox (EANx) Diver"],
    deep: ["Deep Diver"],
    wreck: ["Wreck Diver", "Wreck Diver (External Survey)"],
    night: ["Night Diver"],
    drysuit: ["Dry Suit Diver"],
  },
  sdi: {
    nitrox: ["Computer Nitrox Diver"],
    deep: ["Deep Diver"],
    wreck: ["Wreck Diver"],
    night: ["Night / Limited Visibility Diver"],
    drysuit: ["Drysuit Diver", "Dry Suit Diver"],
  },
  gue: {},
  cmas: {
    nitrox: ["Nitrox Diver"],
  },
  padi: {
    nitrox: ["Enriched Air Diver"],
    deep: ["Deep Diver"],
    wreck: ["Wreck Diver"],
    night: ["Night Diver"],
    drysuit: ["Dry Suit Diver", "Drysuit Diver"],
    cavern: ["Cavern Diver"],
  },
};

/**
 * **A level card that certifies enriched air with it.** GUE's Recreational
 * Diver 1 includes nitrox, so the page's own level line offers a nitrox card,
 * and borrowing the level card's number is right: it is the only number the
 * diver holds for it (the `nitrox_certifications` unique index says why that
 * is no collision).
 */
export const BUNDLED_NITROX: Partial<Record<CheckableAgency, readonly string[]>> = {
  gue: ["Recreational Diver 1"],
};

/**
 * Agencies that may write "Specialty" after a specialty's name ("Deep Diver
 * Specialty"). The word is read as part of the name, so "Deep Diver Specialty
 * Instructor" is still a professional rating.
 */
const SPECIALTY_SUFFIX: ReadonlySet<CheckableAgency> = new Set(["padi"]);

/**
 * **Recreational cards a record may list that DiveDay holds no kind for, and
 * that say nothing about whose record it is.** A line made of one of these,
 * its dates and its numbers neither offers a card nor ends the record, so a
 * diver's Perfect Buoyancy does not hide the Deep card listed under it.
 * Anything else still ends the record: a technical or professional rating, or
 * a word nobody explained. Each agency's own words; a closed list, like the
 * table above.
 */
export const PASS_OVER_WORDING: Record<CheckableAgency, readonly string[]> = {
  ssi: [
    "Perfect Buoyancy",
    "Navigation",
    "Scuba Diver",
    "Boat Diving",
    "Fish Identification",
    "Skin Diver",
  ],
  naui: ["Skin Diver", "Underwater Navigation", "Boat Diver", "Drift Diver"],
  sdi: ["Scuba Diver", "Underwater Navigation", "Boat Diver", "Drift Diver", "Skin Diver"],
  gue: [],
  cmas: [],
  padi: [
    "Scuba Diver",
    "Adventure Diver",
    "Peak Performance Buoyancy",
    "Underwater Navigator",
    "Boat Diver",
    "Drift Diver",
    "Fish Identification",
    "AWARE Fish Identification",
    "Skin Diver",
  ],
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
 *   Never more than {@link RECORD_LINES} lines under the name. The extension
 *   hands back each such record ended exactly here (`excerptAroundName` in
 *   `extension/fill.js`, reading {@link DIVECHEK_RECORD}), every other line
 *   only as its words saying why or how many, with a "…" line, empty once
 *   folded, between lines that were not neighbors.
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
  // Limited, unfinished or lapsed ratings. "Jr" is PADI's short Junior.
  "junior",
  "jr",
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
  // NAUI's own wording.
  "no record was found",
  "no certifications found",
  "no certification found",
  "no matching",
  "no diver found",
  "0 results",
  "could not find",
  "unable to find",
] as const;

/**
 * **An agency's own page furniture around its results**, which is never part
 * of a diver's record: a record ends at a line that starts with one of these.
 * Each is the live page's own text (2026-10-15), held by the fixtures in
 * `src/lib/__fixtures__/agency-pages.ts`. Without it SDI's note under every
 * result, "…might not show up in this online search", read as a limiting word
 * in the record above it, and GUE's footer link "Instructor" as a trainer's
 * title, so neither page could ever match. A closed list, read only at the
 * start of a line, because ending a record early can hide a limit written
 * below the furniture: the furniture's own line is still read for a limiting
 * word ("Request Certification (pending)"), and a line that only mentions the
 * furniture after a rating ("Pending — Request Certification") is the record's.
 */
const PAGE_FURNITURE_WORDS = [
  // SDI, under the results.
  "don t see your certification",
  "request certification",
  // NAUI.
  "please review search information",
  "replacement card request form",
  // GUE's footer.
  "find your gue",
  // CMAS.
  "cookie notice",
] as const;

/**
 * Search controls a record ends at when one is a whole line by itself:
 * CMAS's "Manual Search", SDI's "Search", GUE's "Verify another card" and
 * "Back to search", DiveChek's "Run Report". A search echoed back above its
 * results is not the diver's record.
 */
const SEARCH_CONTROL_LINES = [
  "manual search",
  "search",
  "verify another card",
  "back to search",
  "run report",
  "results",
] as const;

/**
 * Lines under the diver's name line that can belong to their record. The
 * extension's DiveChek excerpt ends a record at the same line
 * ({@link DIVECHEK_RECORD}).
 */
export const RECORD_LINES = 4;
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

/**
 * Whether the record carries this card number **as a whole**: some run of its
 * words, joined, is the number. A number the shop typed short, or the tail of a
 * longer one, is another card (issue #2592); separators the page puts inside a
 * number (`1506 AB 1234`, `N-12345`) still read as one.
 */
function hasCardNumber(record: readonly string[], cardNumber: string | null): boolean {
  const number = cardNumber ? compact(cardNumber) : "";
  if (number.length < 3) return false;
  const words = foldText(record.join(" ")).split(" ");
  for (let start = 0; start < words.length; start += 1) {
    let joined = "";
    for (let end = start; end < words.length && joined.length < number.length; end += 1) {
      joined += words[end];
      if (joined === number) return true;
    }
  }
  return false;
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
export function judgeAgencyPage(input: AgencyPageInput): AgencyCheckVerdict {
  return readAgencyPage(input).verdict;
}

/** What the judge is given: the card and diver as the shop holds them, and the page. */
export type AgencyPageInput = {
  agency: CheckableAgency;
  level: CertificationLevel;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  cardNumber: string | null;
  today: string;
  pageText: string;
};

/** One record the judge read as this diver's: its lines as written and folded, and its verdict. */
type DiverRecord = { raw: string[]; folded: string[]; verdict: RecordVerdict };

/**
 * The judge itself: the verdict, and the records it read as this diver's,
 * which are the only lines {@link agencyListedCards} may read.
 */
function readAgencyPage(input: AgencyPageInput): {
  verdict: AgencyCheckVerdict;
  diverRecords: DiverRecord[];
} {
  const rawLines = input.pageText
    .slice(0, PAGE_TEXT_MAX_LENGTH)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lines = rawLines.map(foldText);
  const first = foldText(input.firstName);
  const last = foldText(input.lastName);
  if (!first || !last) return { verdict: { verdict: "unreadable" }, diverRecords: [] };
  const { needs, dates: order } = AGENCY_CHECKS[input.agency];
  const oneDiver = ONE_RECORD_ONLY.has(input.agency);
  const levelWords = LEVEL_WORDING[input.agency];
  const wording = (levelWords[input.level] ?? []).map(foldText);
  const everyLevelWording = Object.values(levelWords).flat().map(foldText);
  const everyListedWording = [
    ...Object.values(LISTED_CARD_WORDING[input.agency]).flat(),
    ...PASS_OVER_WORDING[input.agency],
  ].map(foldText);
  const limiting: readonly string[] = oneDiver
    ? LIMITING_WORDS
    : [...LIMITING_WORDS, ...TRAINER_WORDS];
  const withoutCardNames = (line: string) =>
    everyListedWording
      .reduce((rest, phrase) => ` ${rest} `.split(` ${phrase} `).join(" "), line)
      .replace(/ +/g, " ")
      .trim();
  const saysNoRecord = (line: string) => NO_RECORD_WORDS.some((phrase) => hasWords(line, phrase));
  const isFurniture = (line: string) =>
    PAGE_FURNITURE_WORDS.some((phrase) => line === phrase || line.startsWith(`${phrase} `)) ||
    SEARCH_CONTROL_LINES.some((control) => line === control);
  const limits = (line: string) => limiting.some((word) => hasWords(withoutCardNames(line), word));
  const ratingWords = (line: string) =>
    everyLevelWording.some((phrase) => hasWords(line, phrase)) ||
    everyListedWording.some((phrase) => hasWords(line, phrase)) ||
    limiting.some((word) => hasWords(line, word));
  // Longest first, so "Advanced Scuba Diver" is taken whole before "Scuba Diver".
  const recordLinePhrases = [...everyLevelWording, ...everyListedWording, ...limiting].sort(
    (a, b) => b.length - a.length,
  );
  /**
   * A line every word of which a record line may carry: a rating's, card's or
   * limit's words, digits, and the few words in `RECORD_LINE_WORDS`.
   */
  const isRecordLine = (line: string) => {
    let rest = ` ${line} `;
    for (const phrase of recordLinePhrases) rest = rest.split(` ${phrase} `).join("  ");
    return rest
      .trim()
      .split(/ +/)
      .every((word) => !word || /\p{N}/u.test(word) || RECORD_LINE_WORDS.has(word));
  };

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
  const splitNameAt = splitNamesOf(rawLines, lines, { first, last, nameIsRating: ratingWords });

  /**
   * A record runs from its name line (`from`, or the pair `from`..`nameEnd`
   * when the name is split over two labelled lines) to `to`, exclusive.
   * `nameLine` is a split name read as one line, given names first.
   */
  type PageRecord = {
    from: number;
    nameEnd: number;
    to: number;
    birthDateLine: number | null;
    nameLine: { raw: string; folded: string } | null;
    /**
     * Possibly the search form echoed back, not a result: never this diver's
     * record and never a namesake, but on DiveChek still a birth date under
     * the name, so a second diver laid out this way is still counted.
     */
    echo: boolean;
  };
  const records: PageRecord[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const nameLine = splitNameAt(index);
    if (!nameLine && !namesDiver(index)) continue;
    const nameEnd = nameLine ? index + 1 : index;
    // A split name's lines carry no digit, so no date of their own.
    const ownDate = !nameLine && datesOn(lines[index] as string, order).length > 0;
    let to = nameEnd + 1;
    while (to < lines.length && to <= nameEnd + RECORD_LINES) {
      const line = lines[to] as string;
      if (saysNoRecord(line)) break;
      if (isFurniture(line)) {
        // "Request Certification (pending)": the limit is still read.
        if (limits(line)) to += 1;
        break;
      }
      // A record laid out under labels holds only a record's kinds of lines:
      // "Federation: FFESSM" or another diver's labeled name ends it.
      if (nameLine && !isRecordLine(line)) break;
      if (oneDiver) {
        if (namesDiver(to) || splitNameAt(to)) break;
        // The birth date's own line, right under a name line without one.
        const birthDateLine = to === nameEnd + 1 && !ownDate && datesOn(line, order).length > 0;
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
    // The search form echoed back under its labels ("First Name: Lena") with a
    // level from the site's menus below is no result: a record laid out under
    // labels dates or numbers its card on the rating's own line.
    const echo =
      nameLine !== null &&
      !lines.slice(nameEnd + 1, to).some((l) => ratingWords(l) && /\p{N}/u.test(l));
    const birthDateLine = ownDate
      ? index
      : nameEnd + 1 < to && datesOn(lines[nameEnd + 1] as string, order).length > 0
        ? nameEnd + 1
        : null;
    records.push({ from: index, nameEnd, to, birthDateLine, nameLine, echo });
  }

  /** A record's lines, folded and as written, its name (split or not) as the first. */
  const recordLinesOf = (record: PageRecord, which: "folded" | "raw"): string[] => {
    const source = which === "folded" ? lines : rawLines;
    if (!record.nameLine) return source.slice(record.from, record.to);
    return [record.nameLine[which], ...source.slice(record.nameEnd + 1, record.to)];
  };

  /** The birth date a DiveChek record carries: the first date on its birth-date line. */
  const recordBirthDate = (record: PageRecord) =>
    record.birthDateLine === null
      ? null
      : (datesOn(lines[record.birthDateLine] as string, order)[0] ?? null);

  /** The record carries what the lookup was typed with, so it is this diver's. */
  const isThisDiver = (record: PageRecord): boolean => {
    if (record.echo) return false;
    const recordLines = recordLinesOf(record, "folded");
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
      return { verdict: { verdict: "several_records" }, diverRecords: [] };
    }
  }

  const judgeRecord = (record: PageRecord): RecordVerdict => {
    const recordLines = recordLinesOf(record, "folded");
    // "Robert Smith Jr.": a suffix straight after the diver's last name on
    // their name line is part of the name, unless a level follows it
    // ("Smith Jr Open Water Diver" may be a junior rating, and stays one).
    recordLines[0] = withoutNameSuffix(recordLines[0] as string, last, everyLevelWording);
    // On DiveChek the level is read from the birth date's line down.
    const levelLines = oneDiver
      ? record.birthDateLine === null
        ? []
        : recordLines.slice(record.birthDateLine - record.nameEnd)
      : recordLines;
    const juniorLevel = (line: string) =>
      everyLevelWording.some(
        (phrase) => hasWords(line, `junior ${phrase}`) || hasWords(line, `jr ${phrase}`),
      );
    // A card's own name is not a limit: SSI's "Night & Limited Visibility
    // Diving" says nothing limited about the diver's card.
    const limited = recordLines.some((line) =>
      limiting.some(
        (word) =>
          hasWords(withoutCardNames(line), word) &&
          !(oneDiver && (word === "junior" || word === "jr") && juniorLevel(line)),
      ),
    );
    if (limited) return "limited_card";
    if (oneDiver && recordLines.some(juniorLevel)) {
      if (!input.birthDate || ageOn(input.birthDate, input.today) < JUNIOR_AGE_END) {
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

  const diverRecords: DiverRecord[] = [];
  let best: { verdict: RecordVerdict; evidence: string } | null = null;
  for (const record of records) {
    if (!isThisDiver(record)) continue;
    const verdict = judgeRecord(record);
    const raw = recordLinesOf(record, "raw");
    diverRecords.push({ raw, folded: recordLinesOf(record, "folded"), verdict });
    if (!best || RECORD_RANK[verdict] > RECORD_RANK[best.verdict]) {
      // A match's words become the card's review note: its lines keep only
      // what is the diver's (S1, and the security review's defense in depth:
      // a neighbour's name inside the window is never kept). Anything short
      // of a match is shown once and kept nowhere, with every word a staffer
      // reads it by.
      best = {
        verdict,
        evidence: evidence(verdict === "match" ? keptRecordWords(raw, input) : raw),
      };
    }
  }
  if (best) return { verdict: best, diverRecords };
  // Someone by this name, never with this birth date or number: another
  // person, whose lines are not the shop's to keep.
  if (records.some((record) => !record.echo)) {
    return { verdict: { verdict: "namesake" }, diverRecords };
  }
  if (lines.some(saysNoRecord)) return { verdict: { verdict: "no_record" }, diverRecords };
  return { verdict: { verdict: "unreadable" }, diverRecords };
}

/**
 * Labels a page may print before a diver's given names or family name, folded:
 * the same labels the extension's DiveChek excerpt keeps (`excerptAroundName`
 * in `extension/fill.js`). A label says which part of the name its line holds.
 */
const NAME_PART_LABELS = {
  given: ["first name", "given name", "forename", "nombre"],
  family: ["last name", "family name", "surname", "apellido", "apellidos"],
} as const;
/** The most words besides the diver's own first or last name a split line may hold. */
const SPLIT_NAME_EXTRA_WORDS = 3;

type NamePart = { part: "given" | "family"; words: string[]; rawValue: string };

/** A line made of one name label and the words after it, as written and folded. */
function labelledNamePart(raw: string, folded: string): NamePart | null {
  for (const part of ["given", "family"] as const) {
    for (const label of NAME_PART_LABELS[part]) {
      if (!folded.startsWith(`${label} `)) continue;
      // The raw tokens after the label's words, so the name keeps its accents.
      const labelWords = label.split(" ").length;
      const tokens = raw.split(" ").filter(Boolean);
      let consumed = 0;
      let at = 0;
      while (at < tokens.length && consumed < labelWords) {
        consumed += foldText(tokens[at] as string)
          .split(" ")
          .filter(Boolean).length;
        at += 1;
      }
      // A token that holds both the label's end and the name ("Name:Lena") is not read.
      if (consumed !== labelWords) return null;
      return {
        part,
        words: folded.slice(label.length + 1).split(" "),
        rawValue: tokens.slice(at).join(" "),
      };
    }
  }
  return null;
}

/**
 * **A diver's name split over two adjacent labelled lines** ("First name:
 * Lena" over "Last name: Ortiz", either order), read as one name line, given
 * names first. Returns, for a line index, that name when a pair starting
 * there is the diver's, else null.
 *
 * Labelled name lines are paired **top to bottom, once**: the first two
 * adjacent lines with different labels are a pair, then the next two after
 * them, so one record's family line never pairs with the next record's given
 * line ("Surname: Lee / Given name: Lena / Surname: Ortiz / Given name: Mark"
 * is Lena Lee and Mark Ortiz, never Lena Ortiz). A pair with a stray labelled
 * name line straight above or below it is refused: which line belongs to whom
 * is a person's call.
 *
 * Narrow on purpose: each line is one label and only a name, the given line
 * starts with the diver's first name and the family line ends with their last
 * (hyphenated names read as they do on one line), a few middle names or
 * particles at most, no digit, and no word a rating, limit or trainer's title
 * could be.
 *
 * `excerptAroundName` in `extension/fill.js` reads pairs the same way, so the
 * DiveChek excerpt judges as the whole page does: a change here is a change
 * there, held by `agency-check.fuzz.test.ts`.
 */
function splitNamesOf(
  rawLines: readonly string[],
  lines: readonly string[],
  diver: { first: string; last: string; nameIsRating: (folded: string) => boolean },
): (index: number) => { raw: string; folded: string } | null {
  const parts = lines.map((line, index) => labelledNamePart(rawLines[index] as string, line));
  const pairStarts = new Set<number>();
  const paired = new Set<number>();
  for (let index = 0; index + 1 < parts.length; ) {
    const a = parts[index];
    const b = parts[index + 1];
    if (a && b && a.part !== b.part) {
      pairStarts.add(index);
      paired.add(index);
      paired.add(index + 1);
      index += 2;
    } else {
      index += 1;
    }
  }
  const stray = (index: number) => parts[index] != null && !paired.has(index);
  const firstWords = diver.first.split(" ");
  const lastWords = diver.last.split(" ");
  return (index) => {
    if (!pairStarts.has(index) || stray(index - 1) || stray(index + 2)) return null;
    const a = parts[index] as NamePart;
    const b = parts[index + 1] as NamePart;
    const given = a.part === "given" ? a : b;
    const family = a.part === "given" ? b : a;
    if (
      given.words.slice(0, firstWords.length).join(" ") !== diver.first ||
      family.words.slice(-lastWords.length).join(" ") !== diver.last
    ) {
      return null;
    }
    if (
      given.words.length > firstWords.length + SPLIT_NAME_EXTRA_WORDS ||
      family.words.length > lastWords.length + SPLIT_NAME_EXTRA_WORDS
    ) {
      return null;
    }
    const folded = `${given.words.join(" ")} ${family.words.join(" ")}`;
    if (/\p{N}/u.test(folded) || diver.nameIsRating(folded)) return null;
    if (TRAINER_WORDS.some((word) => hasWords(folded, word))) return null;
    return { raw: `${given.rawValue} ${family.rawValue}`, folded };
  };
}

/**
 * A folded name line without "jr" or "junior" straight after the diver's last
 * name ("Robert Smith Jr."), unless a level's words follow it.
 */
function withoutNameSuffix(line: string, last: string, levelWording: readonly string[]): string {
  let out = ` ${line} `;
  for (const suffix of ["jr", "junior"]) {
    const at = out.indexOf(` ${last} ${suffix} `);
    if (at < 0) continue;
    const after = out.slice(at + last.length + suffix.length + 3);
    if (levelWording.some((phrase) => ` ${after}`.startsWith(` ${phrase} `))) continue;
    out = `${out.slice(0, at)} ${last} ${after}`;
  }
  return out.replace(/ +/g, " ").trim();
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

/** One card the agency's page lists for this diver that the shop does not hold. */
export type AgencyListedCard = {
  kind: AgencyListedKind;
  /** The agency's name for it, from {@link LISTED_CARD_WORDING}: what the staffer ticks. */
  words: string;
  /** The diver's own lines that list it, for the new card's review note. */
  evidence: string;
  /**
   * Where the agency numbers each card (`numbersTheDiver` false): the number
   * printed on the card's own line, when the line lists that one card and
   * shows exactly one number that is neither a date nor the checked card's.
   * Null there means the card is filed without one and confirmed through the
   * card sighting. Always null where the agency numbers the diver: the card
   * borrows the checked card's number.
   */
  cardNumber: string | null;
};

/** One phrase a record line may be explained by, folded, with what it offers. */
type RecordPhrase = {
  folded: string;
  /** The card it offers, in the agency's words; none for a level or a pass-over. */
  offers: { kind: AgencyListedKind; word: string } | null;
};

/**
 * Every phrase that explains a line of this agency's record: its listed cards
 * (and "<name> Specialty" where it writes that), a level that bundles nitrox,
 * its levels and its pass-over cards. Longest first, so "Enriched Air Nitrox
 * Diver" is taken whole before "Nitrox Diver".
 */
function recordPhrases(agency: CheckableAgency): RecordPhrase[] {
  const offered: RecordPhrase[] = [];
  for (const [kind, words] of Object.entries(LISTED_CARD_WORDING[agency]) as [
    AgencyListedKind,
    readonly string[],
  ][]) {
    for (const word of words) {
      offered.push({ folded: foldText(word), offers: { kind, word } });
      if (SPECIALTY_SUFFIX.has(agency)) {
        offered.push({ folded: foldText(`${word} Specialty`), offers: { kind, word } });
      }
    }
  }
  for (const word of BUNDLED_NITROX[agency] ?? []) {
    offered.push({ folded: foldText(word), offers: { kind: "nitrox", word } });
  }
  const explained = [...Object.values(LEVEL_WORDING[agency]).flat(), ...PASS_OVER_WORDING[agency]]
    .map((word) => ({ folded: foldText(word), offers: null }))
    .filter((phrase) => !offered.some((other) => other.folded === phrase.folded));
  return [...offered, ...explained].sort((a, b) => b.folded.length - a.folded.length);
}

/**
 * **A record's name line, cut to what is the diver's** (S1 of the layer 3
 * review). The line may go on to name the instructor, their dive centre or
 * anyone else; the card keeps only the diver's name as matched, the
 * certifications' names in the agency's words, and the dates and numbers.
 */
function nameLineWords(
  raw: string,
  input: Pick<AgencyPageInput, "firstName" | "lastName">,
  phrases: readonly RecordPhrase[],
  options: { labels?: boolean } = {},
): string {
  const tokens = raw.split(" ").filter(Boolean);
  // Each token's folded words, flattened, remembering which token each came from.
  const words: { word: string; token: number }[] = [];
  tokens.forEach((token, index) => {
    for (const word of foldText(token).split(" ").filter(Boolean)) {
      words.push({ word, token: index });
    }
  });
  const keep = new Set<number>();
  const first = foldText(input.firstName);
  const last = foldText(input.lastName);
  const at = (word: string, from = 0) =>
    words.findIndex((entry, index) => index >= from && entry.word === word);
  const firstAt = at(first);
  const lastAfter = firstAt >= 0 ? at(last, firstAt + 1) : -1;
  const lastAt = at(last);
  const firstAfter = lastAt >= 0 ? at(first, lastAt + 1) : -1;
  const span =
    lastAfter >= 0 ? [firstAt, lastAfter] : firstAfter >= 0 ? [lastAt, firstAfter] : null;
  if (span) {
    for (
      let token = words[span[0] as number]?.token ?? 0;
      token <= (words[span[1] as number]?.token ?? -1);
      token += 1
    ) {
      keep.add(token);
    }
  }
  for (const phrase of phrases) {
    const parts = phrase.folded.split(" ");
    for (let start = 0; start + parts.length <= words.length; start += 1) {
      if (parts.every((part, offset) => words[start + offset]?.word === part)) {
        for (let offset = 0; offset < parts.length; offset += 1) {
          keep.add((words[start + offset] as { token: number }).token);
        }
      }
    }
  }
  const hasDigit = (index: number) => /\p{N}/u.test(tokens[index] ?? "");
  tokens.forEach((token, index) => {
    const folded = foldText(token);
    if (hasDigit(index)) keep.add(index);
    // Under the name line: "Date of birth:", "Card #", "·", and the diver's own name.
    else if (
      options.labels &&
      (!folded ||
        folded
          .split(" ")
          .every((word) => RECORD_LINE_WORDS.has(word) || word === first || word === last))
    ) {
      keep.add(index);
    }
    // A month's name inside a date: "12 Apr 1990".
    else if (monthNumber(foldText(token)) && (hasDigit(index - 1) || hasDigit(index + 1))) {
      keep.add(index);
    }
  });
  return tokens.filter((_, index) => keep.has(index)).join(" ");
}

/**
 * **A record's lines, cut to what is the diver's**, for a review note: the
 * name line as {@link nameLineWords} cuts it, and each line under it kept to
 * the diver's name, the certifications' names in the agency's words, dates,
 * numbers and a record's own labels (`RECORD_LINE_WORDS`). A neighbour's
 * "Mark Lee" inside the window, or an instructor's name after a DiveChek
 * row's date, is never kept. A line left with nothing is dropped.
 */
function keptRecordWords(
  raw: readonly string[],
  input: Pick<AgencyPageInput, "agency" | "firstName" | "lastName">,
): string[] {
  const phrases = recordPhrases(input.agency);
  const [nameLine, ...rest] = raw;
  if (nameLine === undefined) return [];
  return [
    nameLineWords(nameLine, input, phrases),
    ...rest.map((line) => nameLineWords(line, input, phrases, { labels: true })),
  ].filter((line) => /[\p{L}\p{N}]/u.test(line));
}

/**
 * The number printed on a listed card's own line, at an agency that numbers
 * each card: exactly one token with a digit that is not part of a date, not
 * the checked card's own number, and long enough to be a card number.
 */
function cardNumberOn(raw: string, checkedNumber: string | null): string | null {
  const checked = checkedNumber ? compact(checkedNumber) : "";
  const dateLike = /^(\d{1,4}[-./]\d{1,2}[-./]\d{1,4}|\d{1,2}|\d{4})$/;
  const candidates = raw
    .split(" ")
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(
      (token) =>
        /\p{N}/u.test(token) &&
        !dateLike.test(token) &&
        token.length >= MIN_CARD_NUMBER_LENGTH &&
        compact(token) !== checked,
    );
  return candidates.length === 1 ? (candidates[0] as string) : null;
}

/**
 * Words a line about one of the diver's cards may carry besides the card's
 * own name, its dates and its numbers. Anything else on a line is a word
 * nobody explained (another diver's name, a pro rating, a course in
 * progress), and the record is read no further.
 */
const RECORD_LINE_WORDS = new Set([
  "date",
  "of",
  "birth",
  "birthdate",
  "dob",
  "born",
  "certified",
  "certification",
  "certifications",
  "cert",
  "issued",
  "issue",
  "card",
  "number",
  "no",
  "id",
  "diver",
  "member",
  "level",
  "rating",
  "padi",
  "ssi",
  "naui",
  "sdi",
  "gue",
  "cmas",
  ...MONTH_NAMES,
  ...MONTH_NAMES.map((name) => name.slice(0, 3)),
  "sept",
]);

/**
 * **What the extension reads to end a DiveChek record where the judge does**
 * (`DIVECHEK_RECORD` in `extension/protocol.js`, read by `excerptAroundName`
 * in `extension/fill.js`): PADI's words for its levels and cards, the limits,
 * the lines a record ends at, and how a name splits over labelled lines. The
 * excerpt hands back only the diver's records as the judge reads them, so a
 * word changed here is changed there; `cert-check-extension-excerpt.test.ts`
 * fails if the two drift.
 */
export const DIVECHEK_RECORD = {
  recordLines: RECORD_LINES,
  dates: AGENCY_CHECKS.padi.dates,
  levelWording: Object.values(LEVEL_WORDING.padi).flat(),
  listedWording: [...Object.values(LISTED_CARD_WORDING.padi).flat(), ...PASS_OVER_WORDING.padi],
  limitingWords: LIMITING_WORDS,
  trainerWords: TRAINER_WORDS,
  noRecordWords: NO_RECORD_WORDS,
  furnitureWords: PAGE_FURNITURE_WORDS,
  searchControlLines: SEARCH_CONTROL_LINES,
  recordLineWords: [...RECORD_LINE_WORDS],
  monthNames: MONTH_NAMES,
  nameLabels: NAME_PART_LABELS,
  splitNameExtraWords: SPLIT_NAME_EXTRA_WORDS,
};

/**
 * **What one record of the diver lists, line by line** — the scan under
 * {@link agencyListedCards} and {@link judgeAgencyListedCard}, so the two read
 * a record the same way. Null for a record no card may be read from: on
 * DiveChek one that carries another PADI number than the card checked.
 * Otherwise the cards its explained lines list, and the diver's own words from
 * it. A junior or limited record is the caller's to skip.
 */
function listedOnRecord(
  record: DiverRecord,
  input: AgencyPageInput,
): {
  cards: { kind: AgencyListedKind; word: string; cardNumber: string | null }[];
  words: string;
} | null {
  const phrases = recordPhrases(input.agency);
  const oneDiver = ONE_RECORD_ONLY.has(input.agency);
  const nameWords = new Set([foldText(input.firstName), foldText(input.lastName)]);
  const cardNumber = input.cardNumber ? foldText(input.cardNumber) : "";
  const { dates: order, numbersTheDiver } = AGENCY_CHECKS[input.agency];
  // DiveChek: a record under the same name and birth date that carries
  // another PADI number than the card checked may be another diver's, so
  // nothing on it is offered.
  if (oneDiver && input.cardNumber && !hasCardNumber(record.folded, input.cardNumber)) return null;
  const onRecord: { kind: AgencyListedKind; word: string; cardNumber: string | null }[] = [];
  let end = record.folded.length;
  for (let index = 0; index < record.folded.length; index += 1) {
    let line = record.folded[index] as string;
    if (oneDiver) {
      const trainer = TRAINER_WORDS.map((word) => ` ${line} `.indexOf(` ${word} `))
        .filter((at) => at >= 0)
        .sort((a, b) => a - b)[0];
      if (trainer !== undefined) {
        const before = line.slice(0, trainer).trim();
        // "Deep Diver Instructor": a professional rating, not the card.
        if (phrases.some((phrase) => before.endsWith(phrase.folded)) || !before) {
          end = index;
          break;
        }
        line = before;
      }
    }
    let rest = ` ${line} `;
    const here: { kind: AgencyListedKind; word: string }[] = [];
    let explained = false;
    for (const phrase of phrases) {
      if (!rest.includes(` ${phrase.folded} `)) continue;
      rest = rest.split(` ${phrase.folded} `).join("  ");
      if (phrase.offers) here.push(phrase.offers);
      else explained = true;
    }
    // The card number the shop holds ("N-12345").
    if (cardNumber) rest = ` ${rest.trim()} `.split(` ${cardNumber} `).join(" ");
    const unexplained = rest
      .trim()
      .split(/ +/)
      .filter(
        (word) =>
          word.length > 0 &&
          !/\d/.test(word) &&
          !RECORD_LINE_WORDS.has(word) &&
          !(index === 0 && nameWords.has(word)),
      );
    if (unexplained.length > 0) {
      // The name line starts the record whatever else it says; it just lists nothing.
      if (index === 0) continue;
      end = index;
      break;
    }
    // A date on a line naming no card, and not the birth date, may be
    // another diver's birth date: the judge ends a DiveChek record there too.
    const bare = here.length === 0 && !explained;
    if (index > 0 && bare && datesOn(line, order).some((date) => date !== input.birthDate)) {
      end = index;
      break;
    }
    const ownNumber =
      !numbersTheDiver && here.length === 1
        ? cardNumberOn(record.raw[index] as string, input.cardNumber)
        : null;
    onRecord.push(...here.map((card) => ({ ...card, cardNumber: ownNumber })));
  }
  const words = evidence(keptRecordWords(record.raw.slice(0, end), input));
  return { cards: onRecord, words };
}

/**
 * **The other cards an agency's page lists for this diver** (layer 3 of the
 * agency check, ADR 20261008-cert-check-extension): after a match, what the
 * same page shows that DiveDay could hold as nitrox or a specialty and does
 * not yet. Pure, and narrower than the judge on purpose, because these become
 * cards a nitrox fill or a deep site may one day read:
 *
 * - **Only after a match**, and only from the records the judge itself read as
 *   this diver's (the same window, birth date and card number rules), never a
 *   limited or junior one.
 * - **A record is read only as far as every line is explained**: the name
 *   line, the birth date, and lines made only of a card's name in this
 *   agency's words, its dates, its numbers and a few words such as "issued"
 *   (`RECORD_LINE_WORDS`). A recreational card DiveDay holds no kind for
 *   (`PASS_OVER_WORDING`) explains its line too, and offers nothing. The
 *   first line with any other word ends it, so a neighbour's "Mark Lee" and
 *   every line after it are never read, and nor is "Deep Diver Specialty
 *   Instructor" or "Tec Deep Diver".
 * - **On DiveChek** a row may name the instructor who certified the card after
 *   its date ("… 2 Feb 2020 Instructor #123456 Dive Center"): the line is read
 *   up to the trainer's word. A trainer's word straight after a card's name is
 *   a professional rating, and ends the record.
 * - **The agency's own words, from a closed table** (`LISTED_CARD_WORDING`),
 *   and GUE's nitrox from its Recreational Diver 1 (`BUNDLED_NITROX`).
 * - **Never a kind the diver already holds** (`held`): what the shop holds,
 *   less an unsighted nitrox self-declaration, which the card replaces.
 * - **The card's own number** where the agency numbers each card
 *   (`cardNumber`).
 */
export function agencyListedCards(
  input: AgencyPageInput & { held: ReadonlySet<AgencyListedKind> },
): AgencyListedCard[] {
  const read = readAgencyPage(input);
  if (read.verdict.verdict !== "match") return [];
  const found = new Map<AgencyListedKind, AgencyListedCard>();
  for (const record of read.diverRecords) {
    if (record.verdict !== "match" && record.verdict !== "level_unconfirmed") continue;
    const listed = listedOnRecord(record, input);
    if (!listed) continue;
    for (const card of listed.cards) {
      if (input.held.has(card.kind) || found.has(card.kind)) continue;
      found.set(card.kind, {
        kind: card.kind,
        words: card.word,
        evidence: listed.words,
        cardNumber: card.cardNumber,
      });
    }
  }
  return [...found.values()];
}

/** What the judge is given for a nitrox or specialty card: the diver and the card as the shop holds them, and the page. */
export type AgencyListedCardPageInput = Omit<AgencyPageInput, "level" | "cardNumber"> & {
  kind: AgencyListedKind;
  /** The card's own number, which the shop holds for every card this can check. */
  cardNumber: string;
};

/**
 * **Decide what an agency's page says about one pending nitrox or specialty
 * card** (issue #2592). The same page, the same diver rules and the same line
 * reading as {@link agencyListedCards}, asked of a card the shop already
 * holds rather than offered from a level card's match:
 *
 * - **The diver first**: the record must be this diver's by the birth date or
 *   number the lookup was typed with (`readAgencyPage`), and never a junior or
 *   limited one.
 * - **Then the card**: a line of that record in this agency's own words for
 *   this kind (`LISTED_CARD_WORDING`, and GUE's nitrox from its level line),
 *   under the same rule that a record is read only as far as every line is
 *   explained. A "Tec Deep Diver" or a "Deep Diver Specialty Instructor" is
 *   not a Deep card.
 * - **And the card's number** on that record, wherever the agency puts it: a
 *   page that lists the kind for this diver under another number is not this
 *   card (`level_unconfirmed`, for a staffer to read).
 *
 * Never a match from the level card alone, and none for an agency whose table
 * lists no such kind: that is `level_unconfirmed` too, and writes nothing.
 * The verdict names are the level check's, so the one outcome vocabulary
 * serves every card; here `level_unconfirmed` means "the diver, but not this
 * card".
 */
export function judgeAgencyListedCard(input: AgencyListedCardPageInput): AgencyCheckVerdict {
  // The level only decides the level check's own verdict, which is not read
  // here: the records it finds are the diver's whatever their level.
  const page: AgencyPageInput = { ...input, level: "open_water" };
  const read = readAgencyPage(page);
  if (read.diverRecords.length === 0) return read.verdict;
  let seen: string | null = null;
  let limited: AgencyCheckVerdict | null = null;
  for (const record of read.diverRecords) {
    // A junior, limited or unfinished record is shown and never matched.
    if (record.verdict === "limited_card" || record.verdict === "junior_under_15") {
      limited ??= { verdict: record.verdict, evidence: evidence(record.raw) };
      continue;
    }
    const listed = listedOnRecord(record, page);
    if (!listed) continue;
    seen ??= listed.words;
    const lists = listed.cards.some((card) => card.kind === input.kind);
    if (lists && hasCardNumber(record.folded, input.cardNumber)) {
      return { verdict: "match", evidence: listed.words };
    }
  }
  // The staffer reads why the page is short of a match: a limited row first,
  // as the level check says it.
  return limited ?? { verdict: "level_unconfirmed", evidence: seen ?? "" };
}
