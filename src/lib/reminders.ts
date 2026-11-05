/**
 * Pre-trip reminder cadences, framework-free. A cadence is a named point in the
 * run-up to departure at which one reminder is sent. The rules here decide
 * *which* reminder (if any) is due for a booking right now; the DB layer
 * (`src/db/reminders.ts`) does the sending and per-booking dedup, and a cron
 * caller drives the clock (docs ADR 20260721-scheduled-reminder-cadence). No
 * timer lives in the app itself.
 */

import { HOUR_MS } from "@/lib/clock";
import { hasCrossed, rungOffsetMs } from "@/lib/departure-clock";
import type { ChecklistState } from "@/lib/readiness-summary";

/** The cadence kinds, kept in sync with the `notification_kind` enum. */
export type ReminderKind = "trip_reminder_7d" | "trip_reminder_24h";

/** The departure-clock rungs a reminder opens on. */
type ReminderRung = "week_out" | "day_before";

export type ReminderCadence = {
  kind: ReminderKind;
  /** The rung on the departure's clock at which this reminder becomes due. */
  rung: ReminderRung;
  /** How long before departure that is, in hours: the rung, read as a lead time. */
  hoursBefore: number;
};

function cadenceOn(kind: ReminderKind, rung: ReminderRung): ReminderCadence {
  return { kind, rung, hoursBefore: -rungOffsetMs(rung) / HOUR_MS };
}

/**
 * Sorted loosest-first, which is the order of their rungs on the departure's
 * clock: the week-out reminder opens on `week_out`, the dock-call one on
 * `day_before`.
 */
export const TRIP_REMINDER_CADENCES: readonly ReminderCadence[] = [
  cadenceOn("trip_reminder_7d", "week_out"),
  cadenceOn("trip_reminder_24h", "day_before"),
];

/** The widest lead time any cadence needs — how far ahead a scan must look. */
export const MAX_REMINDER_LEAD_HOURS = TRIP_REMINDER_CADENCES.reduce(
  (max, c) => Math.max(max, c.hoursBefore),
  0,
);

export type DueReminderInput = {
  startsAt: Date;
  now: Date;
  /** Reminder kinds already delivered for this booking. */
  sentKinds: ReadonlySet<string>;
};

/**
 * The single reminder due for a booking right now, or null. The cadences'
 * rungs partition the run-up to departure into half-open buckets — the 7-day
 * reminder is due from `week_out` until `day_before`, the 24-hour reminder
 * from `day_before` until `scheduled_start`. `now` lands in at most one
 * bucket, so a booking made late (already inside 24h) gets only the accurate
 * 24-hour text, never a stale "you sail in a week". Already-sent kinds are
 * skipped; nothing fires once the trip departs.
 */
export function dueReminder(input: DueReminderInput): ReminderCadence | null {
  const departure = { startsAt: input.startsAt };
  for (const [index, current] of TRIP_REMINDER_CADENCES.entries()) {
    const closesOn = TRIP_REMINDER_CADENCES[index + 1]?.rung ?? "scheduled_start";
    if (!hasCrossed(current.rung, departure, input.now)) continue;
    if (hasCrossed(closesOn, departure, input.now)) continue;
    if (input.sentKinds.has(current.kind)) continue;
    return current;
  }
  return null;
}

/**
 * One row of the rhythm rule table (issue #1177, delight report D17): whether
 * a cadence sends regardless of what the diver still has to do.
 */
export type ReminderRhythmRule = {
  kind: ReminderKind;
  unconditional: boolean;
  /** Why this row reads the way it does; prose for a human, never rendered. */
  why: string;
};

/**
 * **Which reminders work backward from the remaining action, and which do not.**
 *
 * D17 asks for a rule table over the existing engine rather than a fixed
 * calendar spray, and the two rows split on the same test the ticket states:
 * does this message add new utility?
 *
 * - The **7-day nudge** carries nothing but the diver's own to-do list. With an
 *   empty list it is a warm hello about a boat they already know they are on,
 *   and it costs a send on WhatsApp or SMS to say it.
 * - The **24-hour dock reminder** carries the *time* — the dock call time
 *   (the conditions and who to text stay in the text and the thread). A fully-ready diver needs that as
 *   much as anybody, so its utility is never the task, and it always sends.
 */
export const TRIP_REMINDER_RHYTHM: Record<ReminderKind, ReminderRhythmRule> = {
  trip_reminder_7d: {
    kind: "trip_reminder_7d",
    unconditional: false,
    why: "the week-out nudge is the diver's own to-do list and nothing else",
  },
  trip_reminder_24h: {
    kind: "trip_reminder_24h",
    unconditional: true,
    why: "the dock call time is new utility whatever is settled",
  },
};

/**
 * **Does this reminder earn its send?** Evaluated at send time, over the same
 * checklist the diver's own readiness page renders.
 *
 * The whole design of this predicate is to **fail toward sending**, because it
 * is a suppression and its regression is silence — a diver who hears nothing
 * and misses a boat, with no error and no red test. So it answers true unless
 * it is sure:
 *
 * - an unconditional cadence sends, always;
 * - a `null` checklist means there is no readiness evidence for this booking,
 *   which is not the same as "nothing is outstanding" — we do not know, so we
 *   send;
 * - an **empty** checklist is a trip that gates on nothing, and a shop running
 *   one still wants its divers reminded;
 * - a **`waiting`** item — a medical answer under review, a waiver the shop has
 *   not sent, a trip whose requirements are unconfigured — sends too. Those are
 *   the shop's to finish, and a diver whose boat is a week away and whose
 *   clearance is pending is precisely who should hear from somebody.
 *
 * The one case it suppresses is every item `done`. And nothing is written when
 * it says no: no delivery row, so the cadence stays un-sent and re-arms the
 * moment a fact changes inside its own bucket — the 7-day window is a week wide
 * and this pass runs hourly, so a card that lapses on Wednesday still gets its
 * nudge on Wednesday.
 *
 * Taking the checklist **items and their states** rather than the outstanding
 * *codes* is deliberate and load-bearing. A trip with no `trip_requirements`
 * row collapses the checklist to one `setup` line whose outstanding-code list
 * is empty; a predicate written over those codes would read that shop as
 * "nothing left to do" and silently stop every 7-day reminder it ever sends.
 */
export function reminderEarnsItsSend(
  kind: ReminderKind,
  checklist: readonly { state: ChecklistState }[] | null,
  options: {
    /**
     * A course student whose learning materials nobody has marked done (ADR
     * 20261008-course-learning-materials). That is a to-do of its own, so the
     * week-out nudge still has something to say; ticked, it stops counting.
     */
    courseMaterialsDue?: boolean;
    /**
     * False when the shop switched the week-out reminder off on Features (ADR
     * 20261005-optional-shop-features, amendment 2026-10-23). That silences
     * only the plain "see you next week" hello: an empty checklist. Anything
     * still on the list, the diver's or the shop's, and materials due still
     * send, because the switch never silences a diver who has something to
     * finish before the boat (review 2026-10-23, item 2).
     */
    weekOutHello?: boolean;
  } = {},
): boolean {
  if (TRIP_REMINDER_RHYTHM[kind].unconditional) return true;
  if (options.courseMaterialsDue) return true;
  if (!checklist) return true;
  if (checklist.length === 0) return options.weekOutHello !== false;
  return !checklist.every((item) => item.state === "done");
}
