/**
 * Pre-trip reminder cadences, framework-free. A cadence is a named point in the
 * run-up to departure at which one reminder is sent. The rules here decide
 * *which* reminder (if any) is due for a booking right now; the DB layer
 * (`src/db/reminders.ts`) does the sending and per-booking dedup, and a cron
 * caller drives the clock (docs ADR 20260721-scheduled-reminder-cadence). No
 * timer lives in the app itself.
 */

import { HOUR_MS } from "@/lib/clock";
import type { ChecklistState } from "@/lib/readiness-summary";

/** The cadence kinds, kept in sync with the `notification_kind` enum. */
export type ReminderKind = "trip_reminder_7d" | "trip_reminder_24h";

export type ReminderCadence = {
  kind: ReminderKind;
  /** How long before departure this reminder becomes due. */
  hoursBefore: number;
};

/** Sorted loosest-first; `dueReminder` re-sorts defensively regardless. */
export const TRIP_REMINDER_CADENCES: readonly ReminderCadence[] = [
  { kind: "trip_reminder_7d", hoursBefore: 168 },
  { kind: "trip_reminder_24h", hoursBefore: 24 },
];

/**
 * **Hourly, its own pass.** A once-a-day UTC batch cannot serve more than one
 * longitude: 14:00 UTC is 10am in Florida, 22:00 in Singapore, midnight in
 * Sydney and 03:00 in Fiji, and every shop in the picker's Asia-Pacific group
 * was texting divers in the middle of the night (issue #697). The shop's own
 * send window decides *whether* a pass may send (`src/lib/send-window.ts`);
 * this cadence is what gives every longitude a pass inside its window to be
 * decided in.
 *
 * Separated from the daily `/api/cron/reminders` tick rather than making that
 * hourly, and for the reason `recap-schedule.ts` gives for its own exception:
 * the daily tick's other five scans are durable-retry drains whose backoff
 * bounds derive from `DAILY_TICK_CRONTAB` (`src/lib/cron-schedule.ts`, OPS-6),
 * so changing its cadence would silently move a retry window this ticket has
 * no business touching.
 *
 * `:10` rather than `:00` so it does not land on the same minute as the recap
 * pass, with the minimum-seats sweep already at `:20`.
 */
export const TRIP_REMINDER_CRON_CRONTAB = "10 * * * *";

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
 * The single reminder due for a booking right now, or null. The cadences
 * partition the run-up to departure into half-open buckets — the 7-day reminder
 * is due from T-168h until T-24h, the 24-hour reminder from T-24h until
 * departure. `now` lands in at most one bucket, so a booking made late (already
 * inside 24h) gets only the accurate 24-hour text, never a stale "you sail in a
 * week". Already-sent kinds are skipped; nothing fires once the trip departs.
 */
export function dueReminder(
  input: DueReminderInput,
  cadences: readonly ReminderCadence[] = TRIP_REMINDER_CADENCES,
): ReminderCadence | null {
  const sorted = [...cadences].sort((a, b) => b.hoursBefore - a.hoursBefore);
  const start = input.startsAt.getTime();
  const nowMs = input.now.getTime();
  for (let i = 0; i < sorted.length; i++) {
    const opensAt = start - sorted[i].hoursBefore * HOUR_MS;
    const closesAt = i + 1 < sorted.length ? start - sorted[i + 1].hoursBefore * HOUR_MS : start;
    if (nowMs >= opensAt && nowMs < closesAt && !input.sentKinds.has(sorted[i].kind)) {
      return sorted[i];
    }
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
 * - The **24-hour dock reminder** carries the *time* — the dock call, the
 *   conditions, who to text on the morning. A fully-ready diver needs that as
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
    why: "the dock call, the conditions and who to text are new utility whatever is settled",
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
): boolean {
  if (TRIP_REMINDER_RHYTHM[kind].unconditional) return true;
  if (!checklist || checklist.length === 0) return true;
  return !checklist.every((item) => item.state === "done");
}
