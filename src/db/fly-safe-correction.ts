import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { type Notification, type NotificationProvider, recipientLocale } from "@/lib/notifications";
import type { AppDb, DbExecutor } from "./client";
import { notificationProviderForDb, sendNotification } from "./notifications";
import { bookings, people, shops, trips } from "./schema";
import { livePerson, liveTrip, notRehearsal } from "./trips-live";

/**
 * **Correcting a fly-safe wait a diver was told** (issue #2927, Aaron's
 * decision of 2026-10-22).
 *
 * The night-before email tells a diver on their last boat with the shop how
 * many hours to wait before flying (H-150), from the planned no-decompression
 * rule. When staff then mark that departure as decompression diving, the
 * figure in the diver's inbox no longer applies and `/ready` stops promising
 * one. So the seat records the hours it was told (`bookings.fly_safe_hours_told`),
 * staff see how many divers hold a figure as they tick the box, and each of
 * those divers gets one short correction, once (`fly_safe_corrected_at`).
 */

/** Seats still on the boat: the ones a correction speaks to. */
const LIVE_SEAT_STATUSES = ["booked", "checked_in"] as const;

/**
 * How long after the boat is due back a correction is still worth sending:
 * the longest wait the night-before email can say (`flySafeHours`, at most 48).
 * Past it, every figure the diver was told has run out on its own.
 */
export const FLY_SAFE_CORRECTION_WINDOW_MS = 48 * HOUR_MS;

/** The night-before email went out carrying the fly-safe line: remember what it said. */
export async function recordFlySafeTold(
  db: DbExecutor,
  input: { shopId: string; bookingId: string; hours: number },
): Promise<void> {
  await db
    .update(bookings)
    .set({ flySafeHoursTold: input.hours })
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)));
}

/**
 * After a reminder goes out: a sent night-before email that carried the
 * fly-safe line leaves the seat holding that figure, so marking the departure
 * as decompression diving later can correct it.
 */
export async function rememberFlySafeTold(
  db: DbExecutor,
  input: { shopId: string; bookingId: string; notification: Notification; sent: boolean },
): Promise<void> {
  const { notification } = input;
  if (!input.sent || notification.kind !== "trip_reminder_24h") return;
  if (notification.flySafeHours === undefined) return;
  await recordFlySafeTold(db, {
    shopId: input.shopId,
    bookingId: input.bookingId,
    hours: notification.flySafeHours,
  });
}

/**
 * Seats on this departure told a fly-safe wait and not yet corrected, from
 * rows a reader already holds: the details form's warning, read off the
 * pulse's own seats so it costs no query.
 */
export function flySafeToldUncorrected(
  seats: readonly {
    status: string;
    flySafeHoursTold: number | null;
    flySafeCorrectedAt: Date | null;
  }[],
): number {
  return seats.filter(
    (seat) =>
      (LIVE_SEAT_STATUSES as readonly string[]).includes(seat.status) &&
      seat.flySafeHoursTold !== null &&
      seat.flySafeCorrectedAt === null,
  ).length;
}

export type FlySafeCorrectionOutcome = { told: number; failed: number };

/**
 * **Send each diver told a fly-safe wait the one correction** (issue #2927).
 *
 * Only while the departure is live, scheduled, not a rehearsal, marked as
 * decompression diving, and not more than `FLY_SAFE_CORRECTION_WINDOW_MS`
 * past its end. Only to a seat still on the boat, whose identity is settled,
 * that the night-before email told a figure, by the email on that seat's own
 * person record (the only channel that carried the figure).
 *
 * **Once per seat.** The seat is claimed (`fly_safe_corrected_at`) in the
 * statement that selects it, before anything is sent, so a second save or a
 * race finds nothing owed. A send refused outright puts the claim back, so the
 * next save tries again; a retryable failure is queued by `sendNotification`
 * and stays claimed, because the queue will deliver it.
 */
export async function sendFlySafeCorrections(
  db: AppDb,
  input: { shopId: string; tripId: string; now?: Date; emailProvider?: NotificationProvider },
): Promise<FlySafeCorrectionOutcome> {
  const outcome: FlySafeCorrectionOutcome = { told: 0, failed: 0 };
  const now = input.now ?? nowDate();
  const [row] = await db
    .select({ trip: trips, shop: shops })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(
      and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip(), notRehearsal()),
    )
    .limit(1);
  if (row?.trip.status !== "scheduled" || !row.trip.exceedsNoDecoLimits) return outcome;
  // diveday:allow-departure-offset: the longest fly-safe wait after the boat is due back, not a lateness grace.
  if (now.getTime() > row.trip.endsAt.getTime() + FLY_SAFE_CORRECTION_WINDOW_MS) return outcome;
  const { trip, shop } = row;

  const owed = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, input.shopId)))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, trip.id),
        inArray(bookings.status, [...LIVE_SEAT_STATUSES]),
        isNotNull(bookings.flySafeHoursTold),
        isNull(bookings.flySafeCorrectedAt),
        isNull(bookings.identityUnconfirmedAt),
        livePerson(),
      ),
    );
  if (owed.length === 0) return outcome;
  const claimed = await db
    .update(bookings)
    .set({ flySafeCorrectedAt: now })
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        inArray(
          bookings.id,
          owed.map((seat) => seat.id),
        ),
        isNull(bookings.flySafeCorrectedAt),
      ),
    )
    .returning({ id: bookings.id, personId: bookings.personId });
  if (claimed.length === 0) return outcome;

  const recipients = await db
    .select({ id: people.id, email: people.email, locale: people.locale })
    .from(people)
    .where(
      and(
        eq(people.shopId, input.shopId),
        inArray(
          people.id,
          claimed.map((seat) => seat.personId),
        ),
        livePerson(),
      ),
    );
  const personById = new Map(recipients.map((person) => [person.id, person]));
  const provider = notificationProviderForDb(input.emailProvider);
  const putBack = (bookingId: string) =>
    db
      .update(bookings)
      .set({ flySafeCorrectedAt: null })
      .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, input.shopId)));

  for (const seat of claimed) {
    const person = personById.get(seat.personId);
    // The figure only ever went by email; a seat with no address now has
    // nobody to correct, and is put back for when it has one.
    if (!person?.email) {
      await putBack(seat.id);
      outcome.failed += 1;
      continue;
    }
    let delivery: Awaited<ReturnType<typeof sendNotification>>;
    try {
      delivery = await sendNotification(
        db,
        {
          kind: "fly_safe_correction",
          seatId: seat.id,
          shopId: shop.id,
          to: person.email,
          locale: recipientLocale(person.locale, shop.defaultLocale),
          shopName: shop.name,
          tripTitle: trip.title,
          startsAt: trip.startsAt,
          timezone: shop.timezone,
        },
        provider,
      );
    } catch (error) {
      await putBack(seat.id);
      throw error;
    }
    if (delivery.status === "sent") {
      outcome.told += 1;
      continue;
    }
    outcome.failed += 1;
    if (!(delivery.status === "failed" && delivery.retryable)) await putBack(seat.id);
  }
  return outcome;
}
