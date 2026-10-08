import { foldText } from "./agency-check";

/**
 * **Has a course student finished the agency's eLearning?** (H-106, ADR
 * 20261008-cert-check-extension.)
 *
 * PADI files a student's eLearning under the email it was bought with and
 * shows its progress only on the PADI Pros' Site, to a professional signed in
 * there. DiveDay never holds that sign-in: the DiveDay browser extension opens
 * the page in the staffer's own browser, where they already are signed in, and
 * hands back the page's text. This module decides what that text says, from the
 * student and the course as DiveDay holds them, so the extension can never
 * tick anybody it was not asked about.
 *
 * What a tick means here is bookkeeping, not safety: the course roster's
 * "materials done" (ADR 20261008-course-learning-materials), which gates
 * nothing. The rules are still strict, because a wrong tick quietly tells the
 * instructor a student did homework they did not: the student's name and email
 * in one record, this course's name in that record, and a status that says
 * complete with nothing beside it saying otherwise.
 *
 * Written against what PADI's eLearning list is expected to look like (a row
 * per product: student, email, product, status), not against the live page,
 * which nobody could open from here; see issue #2259.
 */

/** Agencies whose eLearning the extension can read. PADI first; the rest later. */
export const ELEARNING_AGENCIES = ["padi"] as const;
export type ElearningAgency = (typeof ELEARNING_AGENCIES)[number];

export type ElearningQuery = {
  agency: ElearningAgency;
  firstName: string;
  lastName: string;
  email: string;
  courseTitle: string;
};

/** The most of the agency's words shown as evidence. */
export const ELEARNING_EVIDENCE_MAX_LENGTH = 280;
/** The most page text the server reads. */
export const ELEARNING_PAGE_TEXT_MAX_LENGTH = 50_000;
/** Lines after the student's name line that can belong to their record. */
const RECORD_LINES = 6;
/** The longest line read: a status cell is short, and a crafted one is not worth the time. */
const LINE_MAX_LENGTH = 500;

/** Words every eLearning product or course title shares, which name no course. */
const SHARED_WORDS = new Set([
  "padi",
  "course",
  "online",
  "elearning",
  "e",
  "learning",
  "program",
  "programme",
  "the",
  "and",
  "&",
  // How a shop may name its own run of a course PADI sells one eLearning for.
  "referral",
  "touch",
]);

/**
 * Words that make a product a different course from the one a title names
 * unless the title says them too: "Advanced Open Water Diver" holds every word
 * of "Open Water Diver" and is not it.
 */
const OTHER_COURSE_WORDS = [
  "advanced",
  "rescue",
  "master",
  "divemaster",
  "instructor",
  "assistant",
  "specialty",
  "enriched",
  "nitrox",
  "reactivate",
  "refresher",
  "tec",
  "basic",
  "junior",
  "children",
  "upgrade",
  "crossover",
];

/** A status beside the course that is not finished, checked before "complete". */
const NOT_COMPLETE_WORDS = [
  "incomplete",
  "not complete",
  "not completed",
  "in progress",
  "not started",
  "pending",
  "expired",
  "refunded",
  "revoked",
  "cancelled",
  "canceled",
  "suspended",
  "started",
  "partial",
  "assigned",
  "enrolled",
  "awaiting",
  "due",
  "complete by",
  // The first half of Open Water, not the course.
  "scuba diver",
];

const COMPLETE_WORDS = ["complete", "completed"];

const NO_RECORD_WORDS = [
  "no results",
  "no result",
  "no records",
  "no record found",
  "no students found",
  "no matching",
  "0 results",
  "not found",
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * What the extension types into PADI's search for one student on one course:
 * the email PADI files eLearning under, and the name to tell its rows apart.
 * Null when there is nothing to check: another agency, no usable email, a
 * one-word name, or a course title with no words of its own.
 */
export function elearningCheckQuery(input: {
  agency: string;
  fullName: string;
  email: string | null;
  courseTitle: string;
}): ElearningQuery | null {
  if (!(ELEARNING_AGENCIES as readonly string[]).includes(input.agency)) return null;
  const email = input.email?.trim().toLowerCase() ?? "";
  if (!EMAIL.test(email)) return null;
  const words = input.fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  if (courseWords(input.courseTitle).length === 0) return null;
  return {
    agency: input.agency as ElearningAgency,
    firstName: words[0] as string,
    lastName: words[words.length - 1] as string,
    email,
    courseTitle: input.courseTitle,
  };
}

/** The words of a course title that say which course it is, folded. */
export function courseWords(title: string): string[] {
  return foldText(title)
    .split(" ")
    .filter((word) => word.length > 0 && !SHARED_WORDS.has(word));
}

export type ElearningVerdict =
  /** The student's record shows this course finished: tick materials done. */
  | { verdict: "complete"; evidence: string }
  /** The student is there; this course is not shown finished. Nothing written. */
  | { verdict: "not_complete"; evidence: string }
  /** PADI says it found nobody. Nothing written. */
  | { verdict: "no_record" }
  /** The page did not read as a result (a sign-in page, a captcha). Nothing written. */
  | { verdict: "unreadable" };

function hasWords(foldedLine: string, foldedPhrase: string): boolean {
  return foldedPhrase.length > 0 && ` ${foldedLine} `.includes(` ${foldedPhrase} `);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ADDRESS = /[^\s@,;:()<>]+@[^\s@,;:()<>]+\.[a-z]{2,}/gi;
const ADDRESS_ON_LINE = /[^\s@,;:()<>]+@[^\s@,;:()<>]+\.[a-z]{2,}/i;

/** An email address on the line that is not this student's. */
function namesSomeoneElse(rawLine: string, email: string): boolean {
  const addresses = rawLine.toLowerCase().match(ADDRESS) ?? [];
  return addresses.some((address) => address !== email);
}

function isCourseLine(folded: string, words: readonly string[], titleWords: Set<string>): boolean {
  if (!words.every((word) => hasWords(folded, word))) return false;
  return !OTHER_COURSE_WORDS.some((word) => !titleWords.has(word) && hasWords(folded, word));
}

/**
 * "3 of 5", "3/5": a count of parts done, finished only when the two agree.
 * A date's slashes ("03/15/2026") are not a count.
 */
const PART_COUNT = /(?<![\d/])(\d{1,3})\s*(?:of|de|\/)\s*(\d{1,3})(?![\d/])/gi;

function statusOf(rawWindow: readonly string[]): "complete" | "not_complete" {
  const folded = rawWindow.map(foldText);
  const percents = rawWindow.flatMap((line) =>
    [...line.matchAll(/(\d{1,3})\s?%/g)].map((match) => Number(match[1])),
  );
  if (percents.some((percent) => percent < 100)) return "not_complete";
  const partCounts = rawWindow.flatMap((line) => [...line.matchAll(PART_COUNT)]);
  if (partCounts.some((match) => Number(match[1]) < Number(match[2]))) return "not_complete";
  if (folded.some((line) => NOT_COMPLETE_WORDS.some((word) => hasWords(line, word)))) {
    return "not_complete";
  }
  if (percents.includes(100)) return "complete";
  if (folded.some((line) => COMPLETE_WORDS.some((word) => hasWords(line, word)))) {
    return "complete";
  }
  return "not_complete";
}

function evidence(lines: readonly string[]): string {
  const joined = [...new Set(lines)].join(" · ");
  return joined.length > ELEARNING_EVIDENCE_MAX_LENGTH
    ? `${joined.slice(0, ELEARNING_EVIDENCE_MAX_LENGTH - 1).trimEnd()}…`
    : joined;
}

/** A line that is a status and nothing else: "Complete", "100%", "In progress". */
function isStatusOnly(folded: string): boolean {
  let rest = ` ${folded} `;
  for (const word of [...NOT_COMPLETE_WORDS, ...COMPLETE_WORDS]) {
    rest = rest.split(` ${word} `).join(" ");
  }
  rest = rest.replace(/\d{1,3} ?%?/g, " ").replace(/\b(of|status|progress)\b/g, " ");
  return rest.trim() === "" && folded.length > 0;
}

/**
 * Decide what PADI's eLearning page says about one student on one course.
 * Pure: the same text, student and course always give the same verdict.
 */
export function judgeElearningPage(input: {
  firstName: string;
  lastName: string;
  email: string;
  courseTitle: string;
  pageText: string;
}): ElearningVerdict {
  const rawLines = input.pageText
    .slice(0, ELEARNING_PAGE_TEXT_MAX_LENGTH)
    .split(/\r?\n/)
    .map((line) => line.slice(0, LINE_MAX_LENGTH).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lines = rawLines.map(foldText);
  // Names are read with the addresses taken out: "lena.ortiz@…" is not Lena Ortiz.
  const nameLines = rawLines.map((line) => foldText(line.replace(ADDRESS, " ")));
  const first = foldText(input.firstName);
  const last = foldText(input.lastName);
  const email = input.email.trim().toLowerCase();
  const foldedEmail = foldText(email);
  const words = courseWords(input.courseTitle);
  if (!first || !last || !foldedEmail || words.length === 0) return { verdict: "unreadable" };
  const titleWords = new Set(words);
  const nameLine = new RegExp(`(^| )${escapeRegExp(first)}( \\S+)* ${escapeRegExp(last)}( |$)`);
  const saysNoRecord = (line: string) => NO_RECORD_WORDS.some((phrase) => hasWords(line, phrase));

  let found: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (!nameLine.test(nameLines[index] as string)) continue;
    // The record runs on for a few lines, until a second address: another
    // student's, or this one's again on a sibling's row (a family sharing one
    // email), so a record never reads a line that belongs to someone else.
    let seenAddress = ADDRESS_ON_LINE.test(rawLines[index] as string);
    let to = index + 1;
    while (to < lines.length && to <= index + RECORD_LINES) {
      const raw = rawLines[to] as string;
      if (nameLine.test(nameLines[to] as string)) break;
      if (ADDRESS_ON_LINE.test(raw)) {
        if (seenAddress || namesSomeoneElse(raw, email)) break;
        seenAddress = true;
      }
      to += 1;
    }
    if (namesSomeoneElse(rawLines[index] as string, email)) continue;
    const record = lines.slice(index, to);
    if (!hasWords(record.join(" "), foldedEmail)) continue;
    if (record.some(saysNoRecord)) continue;

    for (let at = index; at < to; at += 1) {
      if (!isCourseLine(lines[at] as string, words, titleWords)) continue;
      // The status sits on the course's own line, or alone on the one under it.
      const next = at + 1 < to ? (lines[at + 1] as string) : null;
      const takesNext = next !== null && isStatusOnly(next);
      const window = rawLines.slice(at, takesNext ? at + 2 : at + 1);
      const shown = evidence([rawLines[index] as string, ...window]);
      if (statusOf(window) === "complete") return { verdict: "complete", evidence: shown };
      found ??= shown;
    }
    found ??= evidence(rawLines.slice(index, to));
  }
  if (found) return { verdict: "not_complete", evidence: found };
  if (lines.some(saysNoRecord)) return { verdict: "no_record" };
  return { verdict: "unreadable" };
}
