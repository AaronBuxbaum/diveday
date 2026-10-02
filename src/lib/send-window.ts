import type { Notification } from "./notifications/kinds";
import { utcToWallTime } from "./zoned";

/** Every message kind this app can send, from the one place that enumerates them. */
export type SendableKind = Notification["kind"];

/**
 * **When a shop's automated messages may reach a diver's phone.**
 *
 * Every scheduling rule in this app is anchored to the *departure* — `dueReminder`
 * partitions the run-up into buckets, `recapAutoSendAt` waits for the boat to be
 * back — and each answers "is this message warranted now?" Nobody had asked "is
 * now a reasonable hour to send it?", because the launch market is one US
 * timezone where the fixed 14:00 UTC batch happens to land at 10am (issue #697).
 *
 * Run that same batch against the timezones the signup picker actively promotes
 * and it goes out at 22:00 in Singapore, midnight in Sydney and 03:00 in Fiji —
 * every day, to every diver sailing tomorrow. Recaps are worse: they fire four
 * hours after return, so the demo shop's own 7:30–11:00 PM night dive recaps at
 * 3 AM in *any* zone.
 *
 * The cost is not politeness. A 3 AM SMS is how a diver marks a shop's number as
 * spam, how a WhatsApp Business sender accumulates the negative quality signals
 * Meta throttles on, and how a shop's first week on DiveDay becomes its last.
 *
 * **The shop's civil hours, never the diver's.** A diver's own zone is unknown,
 * guessing it from a phone prefix is unreliable, and someone who booked a dive
 * in Fiji expects Fiji's clock.
 *
 * **One fixed window for every shop.** It was a per-shop setting; the setting
 * was cut (ADR 20261001-logbook), and `DEFAULT_SEND_WINDOW` is now the rule.
 */
export type SendWindow = {
  /** First hour a message may go out, shop-local, 0–23. Inclusive. */
  startHour: number;
  /** First hour it may not, shop-local, 1–24. Exclusive, so 20 means "up to 19:59". */
  endHour: number;
};

/**
 * 08:00–20:00 shop time — the range no diver in any market would call
 * unreasonable, and the one window every shop's automated messages keep.
 */
export const DEFAULT_SEND_WINDOW: SendWindow = { startHour: 8, endHour: 20 };

/**
 * The kinds that go out whatever the hour, named explicitly rather than left to
 * the absence of a rule — "we forgot" and "we decided" must not look identical
 * in this file.
 *
 * Both are **cancellations**. A blow-out at 05:00 for an 07:00 departure has to
 * reach the diver at 05:00: they would rather be woken than drive to the dock.
 * `trip_minimum_not_met` is the same message with a slower cause — the boat is
 * not sailing and the diver's morning is now free — and holding it until 08:00
 * can land it after they have already set off.
 *
 * Everything else waits: reminders, recaps, and the last-minute deal blast are
 * all *marketing or convenience* in the middle of the night, however useful they
 * are at noon.
 */
export const QUIET_HOURS_EXEMPT_KINDS: ReadonlySet<SendableKind> = new Set<SendableKind>([
  "trip_blowout",
  "trip_minimum_not_met",
]);

/**
 * Whether `now` falls inside the send window, in the shop's own wall-clock
 * time.
 *
 * Read through `utcToWallTime` rather than an offset arithmetic shortcut,
 * because a window is a *wall-clock* range: on the morning a zone springs
 * forward, 08:00 local is a different instant than it was yesterday, and a
 * window computed from a fixed offset drifts by an hour twice a year — in the
 * direction that puts the first send of the day before the floor.
 */
export function isWithinSendWindow(now: Date, timeZone: string): boolean {
  const { startHour, endHour } = DEFAULT_SEND_WINDOW;
  const { hour } = utcToWallTime(now, timeZone);
  return hour >= startHour && hour < endHour;
}

/**
 * The one question a sender asks: may this kind go to a diver right now?
 *
 * Holding is safe rather than lossy because of how the two held kinds are
 * scheduled, and it is worth stating which property each relies on:
 *
 * - A **reminder**'s bucket is hours wide — the 24-hour cadence is due from
 *   T-24h right up to departure — and any 24-hour span contains a whole
 *   08:00–20:00 window. Skipping the passes inside quiet hours cannot close the
 *   bucket, so the reminder sends when the window opens.
 * - A **recap** is due from `endsAt + 4h` onwards with no upper bound at all, so
 *   the condition simply stays true until it is sent.
 *
 * Both need the caller's cron to run **hourly**; a once-a-day UTC batch cannot
 * serve more than one longitude, whatever this predicate says.
 */
export function maySendNow(kind: SendableKind, now: Date, timeZone: string): boolean {
  return QUIET_HOURS_EXEMPT_KINDS.has(kind) || isWithinSendWindow(now, timeZone);
}
