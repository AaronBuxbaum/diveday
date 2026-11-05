import { HOUR_MS } from "./clock";

/**
 * **The departure's clock**: every window measured from when a departure is
 * due out or due back is one rung on one ladder, here, and a question about
 * the clock is a named function over it (issue #2714). A module that needs
 * "has it sailed", "is push live" or "is the recap due" asks this file; it
 * does not spell its own offset from `startsAt` or `endsAt`.
 *
 * **What this is not.** A rung is an instant on the schedule, never a claim
 * about who is aboard. `back_grace_over` is not "everyone is back" and
 * `recap_due` is not "the day has settled": those are read off roll-call
 * evidence (glossary "Departure clock"). `trip-stages.ts` is what the crew
 * said and `trip-phase.ts` the staff page's orientation. The one window
 * anchored on *now* rather than on a departure, the horizon
 * (`operational-window.ts`), is not here either.
 *
 * First slice (issue #2714): the rungs the push window, the sailed/returned
 * pair and the recap delay already spelled. The reminder buckets
 * (`reminders.ts`), the arrivals window and the stage-stale offset still keep
 * their own offsets and are the next rungs to move here.
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
 * **The ladder**: each rung is an instant on a departure's own schedule, an
 * offset from its scheduled start or end.
 *
 * - `push_opens`: six hours ahead of the start, the morning of rather than the
 *   week before (ADR 20260804-manifest-web-push).
 * - `sailing_grace_over`: an hour past the scheduled start
 *   ({@link DEPARTURE_BUFFER_MS}); `hasSailed`.
 * - `back_grace_over`: an hour past the scheduled return; `hasReturned`.
 * - `recap_due`: four hours past the scheduled return, when the automatic
 *   recap is due. It waits after a boat already counted as home.
 * - `push_closes`: twelve hours past the end, strictly after which push is
 *   shut, so a late-running day still reaches the boat.
 */
const OFFSETS = {
  push_opens: { anchor: "startsAt", ms: -6 * HOUR_MS },
  sailing_grace_over: { anchor: "startsAt", ms: DEPARTURE_BUFFER_MS },
  back_grace_over: { anchor: "endsAt", ms: DEPARTURE_BUFFER_MS },
  recap_due: { anchor: "endsAt", ms: 4 * HOUR_MS },
  push_closes: { anchor: "endsAt", ms: 12 * HOUR_MS },
} as const satisfies Record<string, { anchor: Anchor; ms: number }>;

export type DepartureRung = keyof typeof OFFSETS;

/** The scheduled instants a rung is measured from; a question names only the one its rung needs. */
type Anchors<R extends DepartureRung> = Record<(typeof OFFSETS)[R]["anchor"], Date>;

/** The offset of a rung from its anchor, for a module that must name the delay (the recap's). */
export function rungOffsetMs(rung: DepartureRung): number {
  return OFFSETS[rung].ms;
}

/** The instant a rung falls on for these scheduled times. */
export function rungTime<R extends DepartureRung>(rung: R, anchors: Anchors<R>): Date {
  const { anchor, ms } = OFFSETS[rung];
  const base = (anchors as Record<Anchor, Date>)[anchor];
  return new Date(base.getTime() + ms);
}

/** True from the rung's instant on. */
export function hasReached<R extends DepartureRung>(
  rung: R,
  anchors: Anchors<R>,
  now: Date,
): boolean {
  return now.getTime() >= rungTime(rung, anchors).getTime();
}

/** True strictly after the rung's instant. */
export function hasPassed<R extends DepartureRung>(
  rung: R,
  anchors: Anchors<R>,
  now: Date,
): boolean {
  return now.getTime() > rungTime(rung, anchors).getTime();
}

/**
 * **Is manifest push live?** From `push_opens` until `push_closes` after the
 * trip's own end. A row whose end is at or before its start (the schema
 * forbids it for schedule days, not for trips) never closes before the
 * departure it is about.
 */
export function pushIsLive(trip: { startsAt: Date; endsAt: Date }, now: Date): boolean {
  const end = trip.endsAt.getTime() > trip.startsAt.getTime() ? trip.endsAt : trip.startsAt;
  return hasReached("push_opens", trip, now) && !hasPassed("push_closes", { endsAt: end }, now);
}
