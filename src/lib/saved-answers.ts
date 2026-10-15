import { REPLY_BODY_MAX_LENGTH } from "./inbox";

/**
 * **Saved answers** (fifth loop, item 15): the words the desk sends often
 * enough to keep. Pure helpers; the rows are `src/db/inbox-saved-answers.ts`.
 *
 * A saved answer is about no diver. It holds two markers instead, `{name}`
 * for the diver's first name and `{trip}` for the departure they are next
 * booked on, filled by the composer from the record it is answering on.
 */

/** The markers a saved answer may hold, as stored and as a staffer types them. */
export const SAVED_ANSWER_MARKERS = ["{name}", "{trip}"] as const;

/** The chip's words: short enough to sit beside four others on a phone. */
export const SAVED_ANSWER_TITLE_MAX = 40;
/** A saved answer is a reply, so it is capped where a reply is. */
export const SAVED_ANSWER_BODY_MAX = REPLY_BODY_MAX_LENGTH;
/** How many a shop keeps live: a row of chips, not a library. */
export const SAVED_ANSWERS_MAX = 12;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `term` as a whole word, any case, so "Ana" never matches inside "cabana". */
function wholeWord(term: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, "giu");
}

/**
 * The sent reply's words with this diver's name taken out: the full name
 * first, then the first name, each swapped for `{name}`. What is written to
 * the shop's saved answers is about nobody.
 */
export function withNameMarker(body: string, fullName: string): string {
  const name = fullName.trim().replace(/\s+/g, " ");
  if (!name) return body;
  const first = name.split(" ")[0] ?? name;
  let out = body.replace(wholeWord(name), "{name}");
  if (first !== name) out = out.replace(wholeWord(first), "{name}");
  return out;
}

/** What the markers become on one diver's record; null leaves the marker. */
export type SavedAnswerFill = { name: string | null; trip: string | null };

/**
 * A saved answer filled for one diver. A marker with nothing to fill it (no
 * trip booked) stays as typed, so the reader sees it in the box before sending
 * rather than a sentence with a hole in it.
 */
export function fillSavedAnswer(body: string, values: SavedAnswerFill): string {
  let out = body;
  if (values.name) out = out.replaceAll("{name}", values.name);
  if (values.trip) out = out.replaceAll("{trip}", values.trip);
  return out;
}

/**
 * The chip's words, from the answer itself: its first line, without markers,
 * cut at a word with "…" when it runs past `SAVED_ANSWER_TITLE_MAX`.
 */
export function savedAnswerTitle(body: string): string {
  const line = (body.split(/\r?\n/).find((candidate) => candidate.trim()) ?? "")
    .replace(/\s*\{(?:name|trip)\}/g, "")
    .replace(/^[\s,.;:!?-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (line.length <= SAVED_ANSWER_TITLE_MAX) return line;
  const cut = line.slice(0, SAVED_ANSWER_TITLE_MAX - 1);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > 10 ? cut.slice(0, atWord) : cut).replace(/[\s,.;:!?-]+$/, "")}…`;
}
