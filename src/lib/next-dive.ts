import type { CertificationLevel } from "./certification-levels";

/**
 * Picks one next departure for the diver and returns its checkable reason
 * (issue #1195; ADR 20260904-reef-all-the-way-down, slice 16i). Reasons use
 * literal evidence in this precedence: crew text names a candidate site;
 * same course; same lens id; same site; otherwise the soonest departure with
 * room. There is no affinity score or inferred course progression.
 *
 * `rankNextDives` exposes the full order for precedence checks;
 * `pickNextDive` returns its head. Codes stay wordless here and are localized
 * in `src/i18n/next-dive-labels.ts` (ADR 20260731-domain-layer-copy-leaks).
 * The anonymous `worth-a-look` surface answers a different question and does
 * not reuse this diver-specific ranking.
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
