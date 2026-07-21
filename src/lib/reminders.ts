/**
 * Pre-trip reminder cadences, framework-free. A cadence is a named point in the
 * run-up to departure at which one reminder is sent. The rules here decide
 * *which* reminder (if any) is due for a booking right now; the DB layer
 * (`src/db/reminders.ts`) does the sending and per-booking dedup, and a cron
 * caller drives the clock (docs ADR 20260721-scheduled-reminder-cadence). No
 * timer lives in the app itself.
 */

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

/** The widest lead time any cadence needs — how far ahead a scan must look. */
export const MAX_REMINDER_LEAD_HOURS = TRIP_REMINDER_CADENCES.reduce(
  (max, c) => Math.max(max, c.hoursBefore),
  0,
);

const HOUR_MS = 60 * 60 * 1000;

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
