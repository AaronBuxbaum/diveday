import { nowDate } from "@/lib/clock";
import type { DiveSiteDifficulty } from "@/lib/dive-site-difficulty";
import { hasSailed } from "@/lib/trips";
import { utcToWallTime } from "@/lib/zoned";

/**
 * **The right departure, not just the next open seat** (ADR
 * 20260904-reef-all-the-way-down, D01/#1161).
 *
 * `similarDepartures` beside this file answers the *full* boat: "you cannot
 * have this one, here are two you can". This answers the boat a diver can
 * still get on and may be reading with a doubt — a Saturday that is deeper
 * than they wanted, an afternoon when they are up early anyway, a boat with
 * one seat left when they are two.
 *
 * **Guidance, never an eligibility decision** — #1161's boundary, and the
 * reason there is no `harder` and no `deeper` code below. Every reason this
 * returns points at a departure that asks *less* of a diver than the one they
 * are reading, or at the same thing on another day. A comparator that could
 * also say "this one is more your level" is one triage note away from becoming
 * the gate the issue forbids, and admission stays where it is
 * (`src/lib/trip-admission.ts`) and readiness stays where it is
 * (`src/lib/readiness.ts`).
 *
 * **Every reason is a visible fact.** The course, the site, the shop's own
 * difficulty rating, the hour on the clock and the seat count are all printed
 * on the departures themselves; nothing here infers anything about the reader,
 * who on this page is anonymous.
 *
 * Pure and framework-free: candidates arrive from
 * `pagedUpcomingTripsWithCounts`, which already filters to public departures
 * with a seat left, and the words live in the diver bundle.
 *
 * D02's shop-authored experience tags (#1162) are not in the schema yet; when
 * 16f adds them they earn a `same_experience` reason above `same_course`. No
 * unused parameter is carried for them today.
 */
export type WorthALookReason =
  | "same_course"
  | "same_site"
  | "gentler"
  | "same_time_of_day"
  | "more_room";

/** The order a reason is preferred in when one candidate could carry several. */
const REASON_RANK: readonly WorthALookReason[] = [
  "same_course",
  "same_site",
  "gentler",
  "same_time_of_day",
  "more_room",
];

export type WorthALookDeparture = {
  tripId: string;
  title: string;
  startsAt: Date;
  seatsOpen: number;
  reason: WorthALookReason;
  /**
   * Which part of the shop's own day this departure leaves in. Carried on the
   * row rather than re-derived by the surface, so "also a morning boat" and the
   * `same_time_of_day` reason can never disagree about where noon is.
   */
  partOfDay: PartOfDay;
};

/** The departure the diver is reading. */
export type WorthALookSubject = {
  tripId: string;
  courseId: string | null;
  diveSiteId: string | null;
  /** The shop's own rating of the site this departure dives, or null when it has not said. */
  difficultyLevel: DiveSiteDifficulty | null;
  startsAt: Date;
  seatsOpen: number;
};

/** One departure that might do instead, as the schedule reader already returns it. */
export type WorthALookCandidate = WorthALookSubject & { title: string };

/** Which part of the shop's own day a departure leaves in. */
export type PartOfDay = "morning" | "afternoon" | "evening";

function partOfDay(startsAt: Date, timeZone: string): PartOfDay {
  const { hour } = utcToWallTime(startsAt, timeZone);
  if (hour < 12) return "morning";
  return hour < 17 ? "afternoon" : "evening";
}

/**
 * The shop rates the candidate's site for beginners and the subject's for
 * anybody else. Only ever this direction: there is no code for the reverse, and
 * a site the shop has not rated is never guessed at.
 */
function isGentler(
  subject: DiveSiteDifficulty | null,
  candidate: DiveSiteDifficulty | null,
): boolean {
  return candidate === "beginner" && (subject === "intermediate" || subject === "advanced");
}

/**
 * A departure only offers "more room" to a diver who is nearly out of it. Two
 * seats left is where a pair starts doing arithmetic; above that the count is a
 * fact the page already prints and not a reason to look elsewhere.
 */
const TIGHT_SEATS = 2;

/**
 * At most `limit` other departures worth a look, **each carrying a different
 * reason**, soonest first.
 *
 * One row per reason is the rule that keeps this from reading as a list: two
 * rows both saying "the same site, another day" are one suggestion printed
 * twice, and the second one costs the reader a line to discover that.
 *
 * Two is the default for the same reason `similarDepartures` gives — one reads
 * as the shop's only answer, three is a list to work through on a page whose
 * job at that moment is the form below it.
 */
export function worthALook(input: {
  subject: WorthALookSubject;
  candidates: readonly WorthALookCandidate[];
  /** The shop's own zone: "also a morning boat" is a claim about the shop's clock. */
  timeZone: string;
  limit?: number;
  now?: Date;
}): WorthALookDeparture[] {
  const limit = input.limit ?? 2;
  if (limit <= 0) return [];
  const now = input.now ?? nowDate();
  const { subject } = input;
  const subjectPart = partOfDay(subject.startsAt, input.timeZone);

  const matched: WorthALookDeparture[] = [];
  for (const candidate of input.candidates) {
    // The boat they are already reading is not an alternative to itself.
    if (candidate.tripId === subject.tripId) continue;
    // A departure that has already left is not worth a look, and the standing
    // late-arrival buffer applies here as everywhere: a boat scheduled forty
    // minutes ago is still at the dock more often than not.
    if (hasSailed(candidate.startsAt, now)) continue;
    // A null on either side is "this departure names no course" / "names no
    // site", and two absences are not a match.
    const reason: WorthALookReason | null =
      subject.courseId && candidate.courseId === subject.courseId
        ? "same_course"
        : subject.diveSiteId && candidate.diveSiteId === subject.diveSiteId
          ? "same_site"
          : isGentler(subject.difficultyLevel, candidate.difficultyLevel)
            ? "gentler"
            : partOfDay(candidate.startsAt, input.timeZone) === subjectPart
              ? "same_time_of_day"
              : subject.seatsOpen <= TIGHT_SEATS && candidate.seatsOpen > subject.seatsOpen
                ? "more_room"
                : null;
    if (!reason) continue;
    matched.push({
      tripId: candidate.tripId,
      title: candidate.title,
      startsAt: candidate.startsAt,
      seatsOpen: candidate.seatsOpen,
      reason,
      partOfDay: partOfDay(candidate.startsAt, input.timeZone),
    });
  }

  // Total rather than merely usually-stable: strongest reason, then soonest,
  // then by id, so two departures at the same minute never swap between
  // renders of the same page.
  matched.sort(
    (a, b) =>
      REASON_RANK.indexOf(a.reason) - REASON_RANK.indexOf(b.reason) ||
      a.startsAt.getTime() - b.startsAt.getTime() ||
      a.tripId.localeCompare(b.tripId),
  );

  const chosen: WorthALookDeparture[] = [];
  const spoken = new Set<WorthALookReason>();
  for (const row of matched) {
    if (chosen.length >= limit) break;
    if (spoken.has(row.reason)) continue;
    spoken.add(row.reason);
    chosen.push(row);
  }
  return chosen;
}
