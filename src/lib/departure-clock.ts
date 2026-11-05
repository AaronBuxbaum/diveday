import { HOUR_MS } from "./clock";

/**
 * **The departure's clock**: every window measured from when a departure is
 * due out or due back is one rung on one ladder, here, and a question about
 * the clock is a named function over it (issue #2714). A module that needs
 * "has it sailed", "is push live", "is the recap due", "which reminder is
 * due", "is this boat on the arrivals desk" or "has the crew's last word gone
 * stale" asks this file; it does not spell its own offset from `startsAt` or
 * `endsAt`.
 *
 * **What this is not.** A rung is an instant on the schedule, never a claim
 * about who is aboard. `back_grace_over` is not "everyone is back" and
 * `recap_due` is not "the day has settled": those are read off roll-call
 * evidence (glossary "Departure clock"), which is why no phase below is named
 * `sailed`, `returned` or `settled`. `trip-stages.ts` is what the crew said
 * and `trip-phase.ts` the staff page's orientation. The one window anchored on
 * *now* rather than on a departure, the operational horizon
 * (`operational-window.ts`), is not here either.
 *
 * Every instant comes from the caller's `now` (the clock, `src/lib/clock.ts`)
 * and the trip's own UTC instants; nothing here reads a zone, because an
 * offset of hours from a stored instant is the same in every one.
 */

/**
 * **The standing late-arrival buffer.** Trips run late, so every "has it
 * sailed / is it back / is it in the past" question in this app allows an hour
 * past the scheduled time before it answers yes (AGENTS.md's hard rule).
 *
 * This constant used to live in `src/features/today/closeout.ts`, where its own docstring
 * said it was here "in one place rather than four literals". It was not. The
 * hour was written **fifteen** times: nine separate `const … = 60 * 60 * 1000`
 * declarations (`closeout`, `ready`, `today`, `roster-facts`,
 * `find-my-booking`, `crew-requests`, `thread-steps`, the diver record's
 * status split, and `COUNTER_DEPARTED_BUFFER_MS` at the walk-in counter) plus
 * six bare literals compared inline in `bookings`, `blowouts`, `today`,
 * `trip-overview` and the diver-facing departure page.
 *
 * What makes that worth a paragraph is *how* it stayed correct. Every one of
 * the nine carried a docstring, and each cited a **different** sibling as the
 * authority: `today` pointed at `ready`, `ready` pointed at `selfCancelBooking`,
 * `roster-facts` pointed at the diver record, the diver record and
 * `crew-requests` pointed at AGENTS.md, and `find-my-booking` simply said
 * "same 1-hour buffer every other check uses". A ring of citations with no
 * centre — which is exactly what a rule looks like shortly before one of its
 * copies is edited alone.
 *
 * They also **disagreed at the boundary**. Most sites treated the departure as
 * gone at `startsAt + 1h` exactly; two — the roster's "ahead" flag and the
 * diver record's — held it upcoming for that one millisecond longer. Nothing
 * depended on the difference, which is the point: it is the shape of a
 * decision nobody made. `hasSailed` (`src/lib/trips.ts`) settles it on the majority reading.
 */
export const DEPARTURE_BUFFER_MS = HOUR_MS;

type Anchor = "startsAt" | "endsAt";

/**
 * When a rung counts as crossed. `at`: from its own instant on. `after`: only
 * strictly after it, so the instant itself still belongs to the side before
 * (push is still live on its last millisecond; the recap is due only once its
 * four hours are over). The convention lives on the rung, so no caller picks
 * an operator.
 */
type Crossing = "at" | "after";

/**
 * **The ladder**: each rung is an instant on a departure's own schedule, an
 * offset from its scheduled start or end.
 *
 * - `week_out`: a week ahead, when the week-out reminder opens
 *   (ADR 20260721-scheduled-reminder-cadence).
 * - `desk_opens`: thirty-six hours ahead, when the arrivals desk starts
 *   showing the boat (today's remaining boats plus tomorrow's).
 * - `day_before`: a day ahead, when the dock-call reminder opens and the
 *   week-out one closes.
 * - `push_opens`: six hours ahead of the start, the morning of rather than the
 *   week before (ADR 20260804-manifest-web-push).
 * - `scheduled_start`: the scheduled start itself, when the last reminder
 *   bucket closes.
 * - `sailing_grace_over`: an hour past the scheduled start
 *   ({@link DEPARTURE_BUFFER_MS}); `hasSailed`.
 * - `desk_closes`: six hours past the start, strictly after which the arrivals
 *   desk drops the boat: a diver can still walk up with a question about a
 *   boat that left this morning.
 * - `back_grace_over`: an hour past the scheduled return; `hasReturned`.
 * - `stage_stale`: two hours past the scheduled return, strictly after which
 *   the crew's last stage word stops being repeated (two buffers: one for a
 *   late boat, one for a busy crew tying up).
 * - `recap_due`: four hours past the scheduled return, strictly after which
 *   the automatic recap is due. It waits after a boat already counted as home.
 * - `push_closes`: twelve hours past the end, strictly after which push is
 *   shut, so a late-running day still reaches the boat.
 */
const OFFSETS = {
  week_out: { anchor: "startsAt", ms: -7 * 24 * HOUR_MS, crossed: "at" },
  desk_opens: { anchor: "startsAt", ms: -36 * HOUR_MS, crossed: "at" },
  day_before: { anchor: "startsAt", ms: -24 * HOUR_MS, crossed: "at" },
  push_opens: { anchor: "startsAt", ms: -6 * HOUR_MS, crossed: "at" },
  scheduled_start: { anchor: "startsAt", ms: 0, crossed: "at" },
  sailing_grace_over: { anchor: "startsAt", ms: DEPARTURE_BUFFER_MS, crossed: "at" },
  desk_closes: { anchor: "startsAt", ms: 6 * HOUR_MS, crossed: "after" },
  back_grace_over: { anchor: "endsAt", ms: DEPARTURE_BUFFER_MS, crossed: "at" },
  stage_stale: { anchor: "endsAt", ms: 2 * DEPARTURE_BUFFER_MS, crossed: "after" },
  recap_due: { anchor: "endsAt", ms: 4 * HOUR_MS, crossed: "after" },
  push_closes: { anchor: "endsAt", ms: 12 * HOUR_MS, crossed: "after" },
} as const satisfies Record<string, { anchor: Anchor; ms: number; crossed: Crossing }>;

export type DepartureRung = keyof typeof OFFSETS;

/** The scheduled instants a rung is measured from; a question names only the one its rung needs. */
export type RungAnchors<R extends DepartureRung> = Record<(typeof OFFSETS)[R]["anchor"], Date>;

/** The offset of a rung from its anchor, for a module that must name the delay (the recap's). */
export function rungOffsetMs(rung: DepartureRung): number {
  return OFFSETS[rung].ms;
}

/** The instant a rung falls on for these scheduled times. */
export function rungTime<R extends DepartureRung>(rung: R, anchors: RungAnchors<R>): Date {
  const { anchor, ms } = OFFSETS[rung];
  const base = (anchors as Record<Anchor, Date>)[anchor];
  return new Date(base.getTime() + ms);
}

/**
 * Whether `now` is past the rung, by the rung's own {@link Crossing}.
 *
 * A raw rung is not a question: `scheduled_start` is crossed with no hour of
 * grace and `desk_closes` is hours past a boat that sailed. Outside this file
 * only the named questions' own homes call it, and
 * `scripts/check-departure-buffer.mjs` refuses any other caller of it or of
 * `onArrivalsDesk`.
 */
export function hasCrossed<R extends DepartureRung>(
  rung: R,
  anchors: RungAnchors<R>,
  now: Date,
): boolean {
  const at = rungTime(rung, anchors).getTime();
  return OFFSETS[rung].crossed === "at" ? now.getTime() >= at : now.getTime() > at;
}

/**
 * **Where a departure is on its own schedule.** The phase begins when the rung
 * beside it is crossed and lasts until the next one is.
 *
 * - `ahead`: more than a week out.
 * - `week_out` (`week_out`), `day_before` (`day_before`), `morning_of`
 *   (`push_opens`): the run-up.
 * - `due_out` (`scheduled_start`): due out, inside the hour of grace. The schedule's word,
 *   not the dock's: a boat tied up waiting for a late diver is still `due_out`.
 * - `scheduled_out` (`sailing_grace_over`): the schedule says the boat has
 *   gone and is not yet due back.
 * - `scheduled_back` (`back_grace_over`): the schedule says it is back; the
 *   recap is not due yet.
 * - `recap_due` (`recap_due`): the recap is due and manifest push still live.
 * - `past` (`push_closes`): the departure's day is over.
 *
 * These rungs are in this order for every departure, because every start rung
 * sits at or before an hour past the start and every end rung at or after an
 * hour past the end. The arrivals desk and the stage's shelf life are rungs but
 * not phases: they cross the start and end rungs differently on a short trip
 * and a long one.
 */
const PHASES = [
  ["week_out", "week_out"],
  ["day_before", "day_before"],
  ["morning_of", "push_opens"],
  ["due_out", "scheduled_start"],
  ["scheduled_out", "sailing_grace_over"],
  ["scheduled_back", "back_grace_over"],
  ["recap_due", "recap_due"],
  ["past", "push_closes"],
] as const satisfies readonly (readonly [string, DepartureRung])[];

export type DeparturePhase = "ahead" | (typeof PHASES)[number][0];

/** The phases in order, `ahead` first. */
export const DEPARTURE_PHASES: readonly DeparturePhase[] = [
  "ahead",
  ...PHASES.map(([phase]) => phase),
];

/** A departure's scheduled instants. */
export type DepartureSchedule = { startsAt: Date; endsAt: Date };

/**
 * The schedule the ladder reads. A row whose end is at or before its start
 * (`trips_ends_after_starts` and the schedule-day check forbid it in the
 * database, and the trip editor answers `end-before-start`) is still read as
 * ending when it starts, for a caller holding a value that never was a row, so
 * it never closes before the departure it is about.
 */
function ladderSchedule(trip: DepartureSchedule): DepartureSchedule {
  return trip.endsAt.getTime() > trip.startsAt.getTime()
    ? trip
    : { startsAt: trip.startsAt, endsAt: trip.startsAt };
}

/** Where this departure is on its own schedule at `now`. */
export function departurePhase(trip: DepartureSchedule, now: Date): DeparturePhase {
  const schedule = ladderSchedule(trip);
  let phase: DeparturePhase = "ahead";
  for (const [next, rung] of PHASES) {
    if (!hasCrossed(rung, schedule, now)) break;
    phase = next;
  }
  return phase;
}

/**
 * **Is manifest push live?** From `push_opens` until `push_closes` after the
 * trip's own end: the phases `morning_of` through `recap_due`.
 */
export function pushIsLive(trip: DepartureSchedule, now: Date): boolean {
  const phase = DEPARTURE_PHASES.indexOf(departurePhase(trip, now));
  return (
    phase >= DEPARTURE_PHASES.indexOf("morning_of") &&
    phase <= DEPARTURE_PHASES.indexOf("recap_due")
  );
}

/**
 * **Is the automatic recap due?** Strictly past the scheduled return plus the
 * recap's delay. Staff may send one by hand before this.
 */
export function recapIsDue(endsAt: Date, now: Date): boolean {
  return hasCrossed("recap_due", { endsAt }, now);
}

/**
 * **Has the crew's last stage word gone stale?** Strictly past `stage_stale`.
 * Not `hasReturned`: the line matters most on a boat that is late, so what
 * expires is DiveDay's licence to keep repeating a word the crew has stopped
 * maintaining, not the boat's claim to be out.
 */
export function stageIsStale(endsAt: Date, now: Date): boolean {
  return hasCrossed("stage_stale", { endsAt }, now);
}

/** Both bounds inclusive: the departures a query reads for one instant. */
export type DepartureWindow = { from: Date; to: Date };

/**
 * **The arrivals window**: the departures the counter shows at `now`, from
 * `desk_opens` before each boat to `desk_closes` after it, turned round into
 * the bounds a query on `startsAt` reads. Never wider than the operational
 * horizon going forward (`arrivalsWindowIsInsideHorizon`).
 */
export function arrivalsWindow(now: Date): DepartureWindow {
  return {
    from: new Date(now.getTime() - rungOffsetMs("desk_closes")),
    to: new Date(now.getTime() - rungOffsetMs("desk_opens")),
  };
}

/**
 * Whether this departure is on the arrivals desk at `now`: the window's own
 * question. Not "has it sailed": the desk keeps a boat for six hours after it
 * left. A gate asks {@link walkInDoorOpen} or `hasSailed`.
 */
export function onArrivalsDesk(startsAt: Date, now: Date): boolean {
  return (
    hasCrossed("desk_opens", { startsAt }, now) && !hasCrossed("desk_closes", { startsAt }, now)
  );
}

/**
 * Whether the counter may still seat a walk-in on a departure: it is on the
 * arrivals desk and has not sailed (the one departure buffer). The staffer's
 * door and the seat action both ask this, so a typed URL or a stale page
 * cannot seat someone on a boat that has gone.
 */
export function walkInDoorOpen(startsAt: Date, now: Date): boolean {
  return onArrivalsDesk(startsAt, now) && !hasCrossed("sailing_grace_over", { startsAt }, now);
}
