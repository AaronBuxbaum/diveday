import { hasReturned } from "@/lib/trips";
import type { CalendarDate } from "./calendar-date";
import { calendarDateInTimezone } from "./calendar-date";

/**
 * **The crew's own half of the staffing week** — what a person says about their
 * availability, and what they ask to work (issue #1235).
 *
 * Staffing shipped as the owner's shift roster (ADR
 * 20260806-staffing-is-the-shift-roster): it shows who is working and which
 * departure has nobody, and every write on it is the owner's. This adds the
 * second actor, and the rule it holds to is the one that ADR and
 * ADR 20260804-buddy-teams already state in their own domains: **it informs, it
 * never gates.**
 *
 * Concretely, that means a blackout does exactly two things and no third:
 *
 * 1. It refuses a *request* the crew member themselves makes for a departure it
 *    covers — a person cannot ask for the Saturday they have just said they are
 *    away for, and being told so at the moment of asking is cheaper than an
 *    owner discovering it a week later.
 * 2. It puts a warning word beside an assignment that now overlaps it. Nobody
 *    is removed from a boat, and no assignment is refused: the owner crews the
 *    shop, a shorthanded Saturday with somebody's holiday on it is a
 *    conversation, and a roster that silently dropped a name would be worse
 *    than one that says something.
 *
 * Framework-free and clock-free, like every other `src/lib` module: the caller
 * passes the shop's zone, and dates arrive as `CalendarDate`.
 */

/** A range of days somebody is away. Inclusive at both ends. */
export type AvailabilityBlock = {
  id: string;
  personId: string;
  startsOn: CalendarDate;
  endsOn: CalendarDate;
  note: string | null;
};

/** Where a request stands. `pending` is the only state the owner has to act on. */
export type CrewRequestState = "pending" | "approved" | "declined";

/** One crew member's ask for one departure. */
export type CrewAssignmentRequest = {
  id: string;
  tripId: string;
  personId: string;
  personName: string;
  state: CrewRequestState;
  requestedAt: Date;
};

/**
 * Whether a range of days covers one calendar day.
 *
 * Calendar dates are ISO `YYYY-MM-DD`, so the comparison is the string's — the
 * same trick `staffing-week.ts` uses for the week's own columns, and the reason
 * neither module needs a date library.
 */
export function blockCoversDay(block: AvailabilityBlock, day: CalendarDate): boolean {
  return block.startsOn <= day && day <= block.endsOn;
}

/**
 * Whether a range of days covers any part of a departure's run.
 *
 * A departure is a run, not a point (`staffing-week.ts`), so this asks about
 * every window it meets in rather than about `starts_at`. The window's end is
 * exclusive for the same reason it is there: a meeting that runs to midnight
 * belongs to the day it started in, so a blackout beginning that midnight does
 * not overlap it.
 */
export function blockCoversMeetings(
  block: AvailabilityBlock,
  meetings: readonly { startsAt: Date; endsAt: Date }[],
  timeZone: string,
): boolean {
  return meetings.some((meeting) => {
    const first = calendarDateInTimezone(meeting.startsAt, timeZone);
    const lastMs = meeting.endsAt.getTime() - 1;
    const last =
      Number.isFinite(lastMs) && lastMs > meeting.startsAt.getTime()
        ? calendarDateInTimezone(new Date(lastMs), timeZone)
        : first;
    // Two inclusive ranges overlap unless one ends before the other starts.
    return block.startsOn <= last && first <= block.endsOn;
  });
}

/**
 * The blackouts of one person that overlap a departure they are already crewing
 * — the warning word, and nothing more.
 *
 * Returned as the blocks themselves rather than a boolean, because the surface
 * says *which* days: "away Sep 12–14" is actionable and "conflict" is not.
 */
export function overlappingBlocks(
  blocks: readonly AvailabilityBlock[],
  personId: string,
  meetings: readonly { startsAt: Date; endsAt: Date }[],
  timeZone: string,
): AvailabilityBlock[] {
  return blocks.filter(
    (block) => block.personId === personId && blockCoversMeetings(block, meetings, timeZone),
  );
}

/**
 * Why a request cannot be made. A code, never a sentence — the surface picks the
 * words (AGENTS.md's domain-layer rule).
 *
 * `already_crewing` is deliberately a refusal rather than a no-op: asking for a
 * boat you are already on is a person who has not seen the roster, and telling
 * them they are on it answers the question they actually had.
 */
export type CrewRequestRefusal = "already_crewing" | "already_requested" | "unavailable" | "past";

/**
 * Whether this person may ask for this departure, from facts alone.
 *
 * Pure, so the surface can grey the affordance out for the same reason the
 * write refuses it — one rule, evaluated twice, rather than a button that
 * offers something the transaction will turn down.
 *
 * `now` is passed rather than read: `src/lib` never touches the wall clock
 * (`src/lib/clock.ts`).
 */
export function crewRequestRefusal(input: {
  personId: string;
  meetings: readonly { startsAt: Date; endsAt: Date }[];
  crewPersonIds: readonly string[];
  livePendingOrDecidedPersonIds: readonly string[];
  blocks: readonly AvailabilityBlock[];
  timeZone: string;
  now: Date;
}): CrewRequestRefusal | null {
  if (input.crewPersonIds.includes(input.personId)) return "already_crewing";
  if (input.livePendingOrDecidedPersonIds.includes(input.personId)) return "already_requested";
  // The same one-hour late-departure buffer every other "has this sailed?"
  // question in the app uses (AGENTS.md's hard rule): a boat that left forty
  // minutes ago is still a boat somebody could be put on.
  const last = input.meetings.reduce(
    (latest, meeting) => Math.max(latest, meeting.endsAt.getTime()),
    Number.NEGATIVE_INFINITY,
  );
  if (Number.isFinite(last) && hasReturned(new Date(last), input.now)) return "past";
  if (overlappingBlocks(input.blocks, input.personId, input.meetings, input.timeZone).length > 0) {
    return "unavailable";
  }
  return null;
}
