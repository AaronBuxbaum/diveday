/**
 * Read-only advisory that composes the consequences of moving a departure
 * (issue #1203). It is not a mutation pre-check: gear races are enforced by
 * `gear_reservations_no_overlap`, and `moveTrip` remains authoritative.
 *
 * Sections report told seats, reserved gear, paid orders, crew clashes or
 * away blocks, and time-dependent conflicts resolved by the panel's target
 * date/time. Empty sections are omitted. Crew clashes and roll-call/status
 * refusals follow `moveTrip`'s rules; away blocks and turnarounds inform but
 * never block. Crew availability by hours is not modeled.
 */

/**
 * The facts a preview is composed from, all of them counts already queryable.
 * Deliberately flat and framework-free: the reader that fills this in lives in
 * `src/db/move-preflight.ts`, and the words live in the staff bundle.
 */
export type MovePreflightFacts = {
  /**
   * Bookings that have already been sent a message stating this departure's
   * date — its confirmation, or one of the two pre-trip reminders. Those divers
   * have the old date in their inbox and the move sends nothing:
   * `notification_deliveries` is unique on (booking, kind), so a confirmation
   * or a cadence already spent is never re-sent for the new one. The list of
   * which messages state a date is in `src/db/move-preflight.ts`.
   */
  toldSeats: number;
  /**
   * Open gear reservations riding on the departure — the exact set
   * `rewindowTripGearReservations` will try to carry across.
   */
  gearReserved: number;
  /**
   * Orders against this departure's bookings that are **paid** — money already
   * taken against the date that is about to change. Deliberately not the unpaid
   * ones: an open invoice is unaffected by a move, so counting it here would be
   * a number with no consequence attached to it.
   */
  paidOrders: number;
  /** The departure's own cancellation window, in hours; null when it sets none. */
  cancellationWindowHours: number | null;
  /**
   * Roll-call rows — divers' and crew's alike — recorded against the
   * departure. Any at all and `moveTrip` refuses with `already_sailed`.
   */
  rollCallEvidence: number;
  /** False for a cancelled departure, which `moveTrip` refuses too. */
  scheduled: boolean;
  /**
   * Other departures on **the same hull** whose windows overlap where the move
   * proposes to put this one (`boatMoveClashes`, H-80: one hull, one departure
   * at a time). Empty when no new time has been chosen yet, for a departure
   * with no boat, and — most of the time — because the boat is free.
   */
  boatClashes: readonly { boat: string; departure: string }[];
  /**
   * Crew the move would put in overlapping departures, with the conflict.
   * Empty until a target time exists, or when none would clash.
   */
  crewClashes: readonly { name: string; departure: string }[];
  /**
   * Assigned crew who reported being away on a proposed day. Advisory only;
   * the owner decides whether to proceed.
   */
  crewAway: readonly string[];
  /**
   * **Tight turnarounds** (issue #2141): live departures closer than the
   * minimum gap without overlapping, on the same hull or shared crew.
   * Information only; H-80's half-open overlap remains the clash rule.
   */
  turnarounds: readonly MoveTurnaround[];
};

/** One near miss: what is squeezed, against which departure, by how many minutes. */
export type MoveTurnaround = {
  kind: "boat" | "crew";
  /** The hull's name, or the crew member's. */
  name: string;
  departure: string;
  /** Whole minutes between one departure due back and the other leaving. */
  minutes: number;
};

/** The shop's minimum turnaround gap until it sets its own (Aaron, 2026-10-13). */
export const DEFAULT_MIN_TURNAROUND_MINUTES = 30;

/** What the settings field accepts; zero turns the line off. */
export const MIN_TURNAROUND_LIMITS = { min: 0, max: 240 } as const;

/** A submitted minimum turnaround, or null when it is not a whole number in range. */
export function parseMinTurnaroundMinutes(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const minutes = Number(raw);
  if (!Number.isInteger(minutes)) return null;
  if (minutes < MIN_TURNAROUND_LIMITS.min || minutes > MIN_TURNAROUND_LIMITS.max) return null;
  return minutes;
}

type Window = { startsAt: Date; endsAt: Date };

/**
 * **The near miss** (issue #2141): the tightest gap, in whole minutes, between
 * any leg of the moved departure and any leg of another, when that gap is
 * under `minGapMinutes` — or null.
 *
 * Null when any pair of legs overlaps: that is a clash, said by its own line
 * through H-80's half-open predicate, and this never restates or changes it.
 * Exactly at the gap is quiet; one minute under speaks. Nose to tail (a gap of
 * zero) speaks here, because no boat unloads, rinses, refills and boards the
 * next group in no time — and stays silent as a clash.
 */
export function turnaroundGapMinutes(
  moved: readonly Window[],
  other: readonly Window[],
  minGapMinutes: number,
): number | null {
  if (minGapMinutes <= 0) return null;
  const minGapMs = minGapMinutes * 60_000;
  let tightest: number | null = null;
  for (const a of moved) {
    for (const b of other) {
      // The half-open overlap the clash readers share: nose to tail is not one.
      if (a.startsAt < b.endsAt && a.endsAt > b.startsAt) return null;
      const gapMs =
        b.startsAt >= a.endsAt
          ? b.startsAt.getTime() - a.endsAt.getTime()
          : a.startsAt.getTime() - b.endsAt.getTime();
      if (gapMs < minGapMs && (tightest === null || gapMs < tightest)) tightest = gapMs;
    }
  }
  return tightest === null ? null : Math.floor(tightest / 60_000);
}

/**
 * One thing the move will do. A section exists only when it has something to
 * report, so an untouched departure composes to none.
 */
export type MovePreflightSection =
  | { kind: "boat"; clashes: readonly { boat: string; departure: string }[] }
  | { kind: "crew"; clashes: readonly { name: string; departure: string }[] }
  | { kind: "crewAway"; names: readonly string[] }
  | { kind: "turnaround"; items: readonly MoveTurnaround[] }
  | {
      /** Seats that have already had a reminder naming the current date. */
      kind: "told";
      reminded: number;
    }
  | { kind: "gear"; count: number }
  | { kind: "money"; paid: number; cancellationWindowHours: number | null };

/**
 * `blocked` mirrors `MoveTripOutcome`'s refusal codes rather than inventing a
 * vocabulary, so the panel can say up front what the redirect would have said
 * afterwards. `sections` is empty for a departure nothing has happened to.
 */
export type MovePreflight = {
  blocked: "already_sailed" | "not_scheduled" | null;
  sections: MovePreflightSection[];
};

/**
 * The preview for one departure. Pure, total, and ordered: the hull that is
 * already out then, the crew rostered elsewhere then, then the crew who said they would not be, then the divers
 * already written to, then the kit, then the money — the reasons to stop, and
 * after them the costs of going ahead, widest to narrowest.
 *
 * A blocked departure still reports its sections. The move is refused, but the
 * facts are the reason it is worth knowing, and blanking them would leave a
 * refusal with nothing behind it.
 */
export function composeMovePreflight(facts: MovePreflightFacts): MovePreflight {
  const sections: MovePreflightSection[] = [];

  // Put blocking conflicts first, with hull conflicts before crew; away is
  // advisory, followed by the information-only turnaround.
  if (facts.boatClashes.length > 0) sections.push({ kind: "boat", clashes: facts.boatClashes });
  if (facts.crewClashes.length > 0) sections.push({ kind: "crew", clashes: facts.crewClashes });
  if (facts.crewAway.length > 0) sections.push({ kind: "crewAway", names: facts.crewAway });
  // A turnaround informs about the squeeze but never blocks a move (#2141).
  if (facts.turnarounds.length > 0) {
    sections.push({ kind: "turnaround", items: facts.turnarounds });
  }

  // Omit empty sections.
  if (facts.toldSeats > 0) sections.push({ kind: "told", reminded: facts.toldSeats });
  if (facts.gearReserved > 0) sections.push({ kind: "gear", count: facts.gearReserved });
  // A cancellation window matters here only when money has been paid.
  if (facts.paidOrders > 0) {
    sections.push({
      kind: "money",
      paid: facts.paidOrders,
      cancellationWindowHours: facts.cancellationWindowHours,
    });
  }

  return { blocked: blockedReason(facts), sections };
}

/**
 * The same two questions `moveTrip` asks, in the same order, so a preview can
 * never promise a move the mutation refuses. Evidence outranks status because
 * the mutation checks status first and evidence second — a cancelled trip that
 * also has a roll call is refused as `not_scheduled` there, and this says so.
 */
function blockedReason(facts: MovePreflightFacts): MovePreflight["blocked"] {
  if (!facts.scheduled) return "not_scheduled";
  if (facts.rollCallEvidence > 0) return "already_sailed";
  return null;
}
