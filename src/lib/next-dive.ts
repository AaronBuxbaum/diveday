import type { CertificationLevel } from "./certification-levels";

/**
 * **One next dive, and one reason it is that one** — delight report D35 (issue
 * #1195), landed as slice 16i of ADR 20260904-reef-all-the-way-down.
 *
 * The recap's last block used to be a bare fact: the shop's next public
 * departure, whatever it was. This picks one *for this diver* and says why in
 * a sentence they can check. The whole module is that "why": a card that
 * cannot state its reason has no business on a keepsake, because the alternative
 * is a recommendation the reader has to take on trust from software that just
 * watched them dive.
 *
 * **Five rules, in one fixed order, and every one is a check rather than an
 * inference.** A reason fires because a literal fact is true, so nothing here
 * can invent an affinity out of a name:
 *
 * 1. `crew_named_site` — the crew's own written word for the day names a site
 *    a candidate goes to. Whole-word containment, case-insensitive, nothing
 *    fuzzier (see `mentionsSite`).
 * 2. `course_next_session` — the day was a session of a course, and the
 *    candidate is another session of that same course. The plan for this slice
 *    called it `course_next_step` over "The next step after {course}", which
 *    the data cannot say: nothing in `courses` records what a course *awards*,
 *    so "after" would have to be inferred from a `minimum_certification_level`
 *    ladder a shop's catalog is under no obligation to be. What is checkable is
 *    `trips.course_id` matching — and it is also the more useful sentence for
 *    the reader it is for, a student mid-course whose next dive is the next day
 *    of the course they are already doing.
 * 3. `same_lens` — the candidate wears the same one of the shop's own words for
 *    a kind of day as the day just dived (`trips.lens_id`, ADR 20260904's
 *    decision 2, slice 16f). A **literal id match** and nothing else: two
 *    lenses whose names read alike are two words the shop chose to keep apart,
 *    and a similarity judgement here is exactly the invented affinity the rest
 *    of this list is built to refuse. Above `same_site` because "another day
 *    like that one" is a better reason than "the same reef again", and below
 *    `course_next_session` because a course session is a commitment the diver
 *    has already made.
 * 4. `same_site` — the candidate goes back to somewhere the day went.
 * 5. `soonest_with_room` — none of the above, so the honest reason is the only
 *    one left: it is next and it has a seat. Dull is fine; invented is not.
 *
 * **No score is exported or returned**, deliberately. A number on the card is
 * a claim about strength that nothing behind it can support, and a number in
 * the props is a number somebody eventually renders.
 *
 * **This module owns the ranking, and 16e's "Also worth a look" (#1161) takes
 * its alternates from `rankNextDives` here** rather than writing a second one.
 * `pickNextDive` is the head of that list and nothing more, so the two can
 * never disagree about which departure leads.
 *
 * Framework-free, deterministic, and wordless: `src/i18n/next-dive-labels.ts`
 * turns each code into a sentence (ADR 20260731-domain-layer-copy-leaks).
 */

/**
 * Why this departure and not another. The order of the union is the precedence
 * order, and `NEXT_DIVE_REASONS` below is the runtime spelling of it.
 */
export type NextDiveReason =
  | "crew_named_site"
  | "course_next_session"
  | "same_lens"
  | "same_site"
  | "soonest_with_room";

/** The precedence, as a value a test can walk. Lower index wins. */
export const NEXT_DIVE_REASONS = [
  "crew_named_site",
  "course_next_session",
  "same_lens",
  "same_site",
  "soonest_with_room",
] as const satisfies readonly NextDiveReason[];

/**
 * One departure the diver could actually take, as the db layer hands it up:
 * already public, already live, already future-with-buffer, already holding a
 * seat, and already past `decideTripAdmission` (src/db/next-dive.ts).
 */
export type NextDiveCandidate = {
  tripId: string;
  title: string;
  startsAt: Date;
  /** The course this departure teaches, when it is a session of one. */
  courseId: string | null;
  /** The course's own name, for the reason sentence. */
  courseTitle: string | null;
  /** The departure's named dive site, or null when it has none on the row. */
  siteName: string | null;
  /**
   * The shop's own word for what kind of day this is (`trips.lens_id`), or null
   * when it wears none. An **id**, never the word: the rule is an equality and
   * the sentence takes its noun from the day's lens, which by definition is the
   * same row whenever the rule fires.
   */
  lensId: string | null;
  /**
   * The level the trip and its sites demand between them, or null when the
   * departure asks nothing of anybody. Only ever *stated* on the card — this is
   * a fact about the trip, and admission has already proven the diver clears it.
   */
  requiredLevel: CertificationLevel | null;
  /** Seats free right now: `capacity - booked`, never negative. */
  seatsLeft: number;
};

/** What the day that just happened knows about itself, for the rules above. */
export type NextDiveDay = {
  /** The departure the diver has just come home from — never the pick. */
  justDivedTripId: string;
  /** The course that day taught, when it taught one. */
  courseId: string | null;
  /** The crew's own written word for the day (`trips.recap_shoutout`), or null. */
  shoutout: string | null;
  /** Every site the day actually went to. */
  siteNames: readonly string[];
  /** The lens the day wore, or null. Compared to a candidate's by id alone. */
  lensId: string | null;
  /**
   * That lens in the shop's own words, for the sentence. Read from the day
   * rather than the candidate because `same_lens` fires only on an id match, so
   * the two are the same row — and one read answers for every candidate.
   */
  lensName: string | null;
};

export type NextDivePick = {
  tripId: string;
  title: string;
  startsAt: Date;
  reason: NextDiveReason;
  /** The site the reason names, on `crew_named_site` and `same_site`. */
  reasonSite?: string;
  /** The course the reason names, on `course_next_session`. */
  reasonCourse?: string;
  /** The shop's word for the kind of day, on `same_lens`. */
  reasonLens?: string;
  /**
   * The level this departure demands, when it demands one — worded as "your
   * {level} card covers it", because admission has already cleared the diver.
   * Null on a departure that asks nothing, where saying so would be a rule
   * dressed up out of the absence of one.
   */
  levelCovered: CertificationLevel | null;
  seatsLeft: number;
};

export type NextDiveInput = {
  day: NextDiveDay;
  candidates: readonly NextDiveCandidate[];
};

/**
 * **Whole-word, case-insensitive containment** — the only thing that may fire
 * `crew_named_site`.
 *
 * "Come back for the Spiegel Grove" names Spiegel Grove. "The reef was flat"
 * does not name "The Reefer", and a substring test would say it did. The site
 * name is escaped before it becomes a pattern, because it is a shop's free text
 * and a `(` in it would otherwise throw rather than fail to match.
 *
 * The boundary is asserted on each end only where the name's own edge character
 * is a word character: a site legitimately called "Christ of the Abyss (statue)"
 * ends in a paren, and `\b` after it would demand a following word character.
 */
export function mentionsSite(shoutout: string | null, siteName: string | null): boolean {
  if (!shoutout || !siteName) return false;
  const name = siteName.trim();
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lead = /^\w/.test(name) ? "\\b" : "";
  const tail = /\w$/.test(name) ? "\\b" : "";
  return new RegExp(`${lead}${escaped}${tail}`, "iu").test(shoutout);
}

/** Why this candidate would be picked. Every candidate has one — the fifth is the floor. */
function reasonFor(candidate: NextDiveCandidate, day: NextDiveDay): NextDiveReason {
  if (mentionsSite(day.shoutout, candidate.siteName)) return "crew_named_site";
  if (day.courseId !== null && candidate.courseId === day.courseId) return "course_next_session";
  // Literal id equality, deliberately. Two lenses a shop worded similarly are
  // still two words it chose to keep apart, and anything looser here would be
  // the invented affinity every other rule in this module refuses.
  if (day.lensId !== null && candidate.lensId === day.lensId) return "same_lens";
  if (
    candidate.siteName !== null &&
    day.siteNames.some(
      (name) => name.trim().toLowerCase() === candidate.siteName?.trim().toLowerCase(),
    )
  ) {
    return "same_site";
  }
  return "soonest_with_room";
}

function rankOf(reason: NextDiveReason): number {
  return NEXT_DIVE_REASONS.indexOf(reason);
}

/**
 * Every candidate this diver could be pointed at, best first — the reason's
 * precedence, then the soonest departure, then the trip id so the order is
 * total and a frozen clock renders the same card twice.
 *
 * The departure just dived is dropped here rather than by the caller: "go back
 * to the thing you already did" is the one recommendation that is never a next
 * dive, and it can arrive as a candidate honestly (a weekly charter's next
 * instance is a different row, but a multi-day trip's own id is not).
 */
export function rankNextDives(input: NextDiveInput): NextDivePick[] {
  return input.candidates
    .filter((candidate) => candidate.tripId !== input.day.justDivedTripId)
    .map((candidate) => ({ candidate, reason: reasonFor(candidate, input.day) }))
    .sort(
      (a, b) =>
        rankOf(a.reason) - rankOf(b.reason) ||
        a.candidate.startsAt.getTime() - b.candidate.startsAt.getTime() ||
        (a.candidate.tripId < b.candidate.tripId ? -1 : 1),
    )
    .map(({ candidate, reason }) => ({
      tripId: candidate.tripId,
      title: candidate.title,
      startsAt: candidate.startsAt,
      reason,
      ...(reason === "crew_named_site" || reason === "same_site"
        ? { reasonSite: candidate.siteName ?? undefined }
        : {}),
      ...(reason === "course_next_session"
        ? { reasonCourse: candidate.courseTitle ?? undefined }
        : {}),
      ...(reason === "same_lens" ? { reasonLens: input.day.lensName ?? undefined } : {}),
      levelCovered: candidate.requiredLevel,
      seatsLeft: candidate.seatsLeft,
    }));
}

/** The one departure the recap names, or null when the board has nothing for this diver. */
export function pickNextDive(input: NextDiveInput): NextDivePick | null {
  return rankNextDives(input)[0] ?? null;
}
