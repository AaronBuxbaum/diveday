import type { notificationKind } from "@/db/schema";

/** Every kind a `notification_deliveries` row can carry. */
export type NotificationDeliveryKind = (typeof notificationKind.enumValues)[number];

/**
 * The delivery kinds a booking receives at most once (issue #2728).
 *
 * `notification_deliveries` holds one row per send. These kinds are the
 * exception: their sender decides whether to send by asking whether a row
 * already exists, so a second row would be a second message. A partial unique
 * index over exactly these kinds keeps them to one row per booking, and a
 * retry of one updates that row's outcome instead of adding a row.
 *
 * - `booking_confirmation`: "your seat is booked" is said once; a staff resend
 *   from Today replaces the failed outcome, and `bookingConfirmationMailState`
 *   reads the one row.
 * - `trip_reminder_7d`, `trip_reminder_24h`: the reminder pass sends a cadence
 *   only while no `sent` row exists for it (`src/db/reminders.ts`); a move
 *   re-arms them by deleting the rows (`src/db/reminder-rearm.ts`).
 * - `trip_recap`: the recap pass sends only while no `sent` row exists
 *   (`src/db/recap.ts`).
 *
 * Every other kind may legitimately go more than once (a fresh waiver link, a
 * rescued trip-prep link, a second reschedule, a retried blow-out notice) and
 * gets one row per attempt; its readers take the latest row.
 */
export const ONCE_ONLY_DELIVERY_KINDS = [
  "booking_confirmation",
  "trip_reminder_7d",
  "trip_reminder_24h",
  "trip_recap",
] as const satisfies readonly NotificationDeliveryKind[];

export type OnceOnlyDeliveryKind = (typeof ONCE_ONLY_DELIVERY_KINDS)[number];

export function isOnceOnlyDeliveryKind(
  kind: NotificationDeliveryKind,
): kind is OnceOnlyDeliveryKind {
  return (ONCE_ONLY_DELIVERY_KINDS as readonly string[]).includes(kind);
}

/**
 * The partial unique index's predicate, as SQL text. The schema declares the
 * index with it and `recordNotificationDelivery` names it as its conflict
 * target, so the two can never describe different sets of kinds.
 */
export const ONCE_ONLY_DELIVERY_KINDS_PREDICATE = `"kind" in (${ONCE_ONLY_DELIVERY_KINDS.map(
  (kind) => `'${kind}'`,
).join(", ")})`;
