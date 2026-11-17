import { meetingDayWindows } from "./trip-days";
import { tripPhaseOf } from "./trip-phase";
import { shopDayBounds } from "./zoned";

/**
 * **The Clock: the five phases a staffer works a departure through** (ADR
 * 20261117-trip-page-clock). Filling, Getting ready, Check-in, On the water,
 * Wrapped up: each names the *kind of work* the page is for, never where
 * people are. Where people are comes only from recorded roll-call evidence
 * and the crew's own stage taps.
 *
 * Built on {@link tripPhaseOf}, never beside it, so the crew's word still
 * beats the clock and a multi-day run is read by its meeting days:
 *
 * - `prep` splits at shop-local midnight of the day before the departure's
 *   own day (on a multi-day run, the day before the next meeting day, the same
 *   anchor `tripPhaseOf` uses for Check-in): `filling` before, `ready` from.
 * - `checkin` is `checkin`, `aboard` is `water`, `back` is `wrapped`.
 * - A cancelled departure has no phase (`null`); its page opens on Wrapped up.
 */
export const CLOCK_PHASES = ["filling", "ready", "checkin", "water", "wrapped"] as const;

export type ClockPhase = (typeof CLOCK_PHASES)[number];

type ClockInput = Parameters<typeof tripPhaseOf>[0];

export function isClockPhase(value: unknown): value is ClockPhase {
  return typeof value === "string" && (CLOCK_PHASES as readonly string[]).includes(value);
}

/**
 * The start of the next day the departure meets on: the departure itself, or
 * on a multi-day run with its meeting days on file, the next of them still
 * ahead (the anchor `tripPhaseOf` uses between a course's days).
 */
export function nextMeetingStart(input: ClockInput): Date {
  const { startsAt, endsAt, now, meetingWindows } = input;
  if (meetingWindows && meetingWindows.length > 1) {
    const days = meetingDayWindows({ startsAt, endsAt }, meetingWindows);
    const next = days.find((day) => day.startsAt.getTime() > now.getTime());
    if (next) return next.startsAt;
  }
  return startsAt;
}

/** Shop-local midnight of the day before `anchor`'s own shop day. */
export function readyFrom(anchor: Date, timeZone: string): Date {
  const day = shopDayBounds(anchor, timeZone);
  return shopDayBounds(new Date(day.from.getTime() - 1), timeZone).from;
}

/** The phase the departure is in now, or `null` for a cancelled one. */
export function clockPhaseOf(input: ClockInput): ClockPhase | null {
  const phase = tripPhaseOf(input);
  switch (phase) {
    case null:
      return null;
    case "prep":
      return input.now.getTime() >= readyFrom(nextMeetingStart(input), input.timeZone).getTime()
        ? "ready"
        : "filling";
    case "checkin":
      return "checkin";
    case "aboard":
      return "water";
    case "back":
      return "wrapped";
  }
}

/**
 * The phase a page shows: the one asked for by `?phase=`, else the current
 * one, else (a cancelled departure) Wrapped up.
 */
export function shownClockPhase(asked: string | undefined, current: ClockPhase | null): ClockPhase {
  if (isClockPhase(asked)) return asked;
  return current ?? "wrapped";
}

/** Where a phase stands against the current one. */
export type PhaseStanding = "done" | "now" | "ahead";

export function phaseStanding(phase: ClockPhase, current: ClockPhase | null): PhaseStanding {
  if (current === null) return "ahead";
  const at = CLOCK_PHASES.indexOf(phase);
  const now = CLOCK_PHASES.indexOf(current);
  return at < now ? "done" : at === now ? "now" : "ahead";
}

/**
 * The small "when" under each phase on the strip, as data: a renderer picks
 * the words. `seats` is "11 of 14", `here` "11 here", `day` a zoned weekday,
 * `time` a zoned time.
 */
export type PhaseWhen =
  | { kind: "seats"; booked: number; capacity: number }
  | { kind: "here"; count: number }
  | { kind: "done" }
  | { kind: "now" }
  | { kind: "day"; at: Date }
  | { kind: "time"; at: Date };

export function phaseWhens(
  input: ClockInput & {
    booked: number;
    capacity: number;
    /** Guests checked in, when the page has read it; Check-in then says "11 here" once done. */
    here?: number | null;
  },
): Record<ClockPhase, PhaseWhen | null> {
  const current = clockPhaseOf(input);
  const seats: PhaseWhen = { kind: "seats", booked: input.booked, capacity: input.capacity };
  if (current === null) {
    return { filling: seats, ready: null, checkin: null, water: null, wrapped: null };
  }
  const anchor = nextMeetingStart(input);
  const anchorDay = shopDayBounds(anchor, input.timeZone);
  const sameDayAsAnchor = (at: Date) =>
    at.getTime() >= anchorDay.from.getTime() && at.getTime() < anchorDay.to.getTime();
  const timeOrDay = (at: Date): PhaseWhen =>
    sameDayAsAnchor(at) ? { kind: "time", at } : { kind: "day", at };
  const standing = (phase: ClockPhase) => phaseStanding(phase, current);
  const pick = (phase: ClockPhase, ahead: PhaseWhen, done: PhaseWhen): PhaseWhen => {
    const at = standing(phase);
    return at === "now" ? { kind: "now" } : at === "done" ? done : ahead;
  };
  const here: PhaseWhen =
    input.here != null && input.here > 0 ? { kind: "here", count: input.here } : { kind: "done" };
  return {
    filling: seats,
    ready: pick("ready", { kind: "day", at: readyFrom(anchor, input.timeZone) }, { kind: "done" }),
    checkin: pick("checkin", { kind: "day", at: anchorDay.from }, here),
    water: pick("water", timeOrDay(anchor), { kind: "done" }),
    wrapped: pick("wrapped", timeOrDay(input.endsAt), { kind: "done" }),
  };
}

/** The element id of Filling's wait list (`FillSeatsCard`). */
export const WHO_WANTS_IN_ID = "who-wants-in";

/**
 * Where "who wants in" lives: Filling's card. Every link to the wait list
 * names the phase, because on the day the page opens on Check-in or later,
 * where the card is not drawn.
 */
export function whoWantsInHref(tripPath: string): string {
  return `${tripPath}?phase=filling#${WHO_WANTS_IN_ID}`;
}
