import { and, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import {
  type Notification,
  type NotificationDelivery,
  type NotificationProvider,
  recipientLocale,
} from "@/lib/notifications";
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
    .set({ flySafeHoursTold: input.hours, flySafeCorrectedAt: null })
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)));
}

/**
 * A sent figure or an ambiguous retryable provider failure may have reached
 * the diver. The latter is conservative exposure, not evidence of acceptance
 * or of a successfully persisted retry.
 */
export function deliveryCarriesFigure(delivery: NotificationDelivery): boolean {
  return (
    delivery.status === "sent" || (delivery.status === "failed" && delivery.retryable === true)
  );
}

/**
 * Record a sent or potentially accepted night-before figure, so a later
 * decompression change can correct it even when provider failure is ambiguous.
 */
export async function rememberFlySafeTold(
  db: DbExecutor,
  input: {
    shopId: string;
    bookingId: string;
    notification: Notification;
    delivery: NotificationDelivery;
  },
): Promise<void> {
  const { notification } = input;
  if (!deliveryCarriesFigure(input.delivery) || notification.kind !== "trip_reminder_24h") return;
  if (notification.flySafeHours === undefined) return;
  await recordFlySafeTold(db, {
    shopId: input.shopId,
    bookingId: input.bookingId,
    hours: notification.flySafeHours,
  });
}

/** Reconcile the seat's current departure after a reminder is accepted or its delivery is uncertain. */
export async function correctFlySafeForBooking(
  db: AppDb,
  input: { shopId: string; bookingId: string; now?: Date; emailProvider?: NotificationProvider },
): Promise<FlySafeCorrectionOutcome> {
  const [seat] = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  if (!seat) return { told: 0, failed: 0, unreached: [] };
  return sendFlySafeCorrections(db, { ...input, tripId: seat.tripId });
}

/** Retry unqueued or refused corrections on the next scheduled reminder pass. */
export async function retryOwedFlySafeCorrections(
  db: AppDb,
  input: { now: Date; emailProvider: NotificationProvider },
): Promise<void> {
  const due = await db
    .selectDistinct({ shopId: trips.shopId, tripId: trips.id })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
    .where(
      and(
        inArray(bookings.status, [...LIVE_SEAT_STATUSES]),
        isNotNull(bookings.flySafeHoursTold),
        isNull(bookings.flySafeCorrectedAt),
        eq(trips.status, "scheduled"),
        eq(trips.exceedsNoDecoLimits, true),
        liveTrip(),
        notRehearsal(),
        gte(trips.endsAt, new Date(input.now.getTime() - FLY_SAFE_CORRECTION_WINDOW_MS)),
      ),
    );
  for (const trip of due) {
    try {
      const outcome = await sendFlySafeCorrections(db, { ...trip, ...input });
      if (outcome.unreached.length)
        log("reminder.fly_safe_correction_unreached", "error", {
          shopId: trip.shopId,
          count: outcome.unreached.length,
        });
    } catch (error) {
      log("reminder.fly_safe_correction_retry_failed", "error", {
        shopId: trip.shopId,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }
  }
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

/**
 * What a pass did: how many corrections went, how many did not go now
 * (`failed`, which counts a send queued for the next pass), and the divers it
 * could not reach at all (no address, a refused send), by name, so the
 * staffer who ticked the box knows whom to call.
 */
export type FlySafeCorrectionOutcome = { told: number; failed: number; unreached: string[] };

/**
 * **Send each diver told a fly-safe wait the one correction** (issue #2927).
 *
 * Only while the departure is live, scheduled, not a rehearsal, marked as
 * decompression diving, and not more than `FLY_SAFE_CORRECTION_WINDOW_MS`
 * past its end. Only to a seat still on the boat that the night-before email
 * told a figure, held identity or not, by the email on that seat's own person
 * record (the only channel that carried the figure).
 *
 * **Once per seat.** The seat is claimed (`fly_safe_corrected_at`) in the
 * statement that selects it, before anything is sent, so a second save or a
 * race finds nothing owed. Any seat not sent or queued by the end, a refused
 * send, no address, or the rest of the batch after a provider throws, has its
 * claim put back, so a later pass tries again. A retryable failure holds its
 * claim only when its queue write succeeded; the queue then retries it.
 * A throw still propagates, after the put-back.
 */
export async function sendFlySafeCorrections(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    /** Limit a move or reminder reconciliation to the affected seat. */
    bookingId?: string;
    now?: Date;
    emailProvider?: NotificationProvider;
    /** The one send door; a test passes one that throws to prove the put-back. */
    send?: typeof sendNotification;
  },
): Promise<FlySafeCorrectionOutcome> {
  const outcome: FlySafeCorrectionOutcome = { told: 0, failed: 0, unreached: [] };
  const send = input.send ?? sendNotification;
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

  // A held seat (identity unconfirmed) is corrected too: the figure went to
  // the address on the seat's person, so the correction goes to the same one.
  const owed = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, input.shopId)))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, trip.id),
        input.bookingId ? eq(bookings.id, input.bookingId) : undefined,
        inArray(bookings.status, [...LIVE_SEAT_STATUSES]),
        isNotNull(bookings.flySafeHoursTold),
        isNull(bookings.flySafeCorrectedAt),
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
        eq(bookings.tripId, trip.id),
        inArray(bookings.status, [...LIVE_SEAT_STATUSES]),
        isNotNull(bookings.flySafeHoursTold),
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
    .select({
      id: people.id,
      fullName: people.fullName,
      email: people.email,
      locale: people.locale,
    })
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
  // Every claimed seat starts unsent. A seat leaves this set only once its
  // correction went or was queued; whatever is left when the loop ends, by
  // any exit including a throw, has its claim put back for the next save.
  const unsent = new Set(claimed.map((seat) => seat.id));
  const unreached = (personId: string) => {
    outcome.failed += 1;
    outcome.unreached.push(personById.get(personId)?.fullName ?? "");
  };
  try {
    for (const seat of claimed) {
      const person = personById.get(seat.personId);
      // The figure only ever went by email; a seat with no address now has
      // nobody to correct by email, and staff are told to call.
      if (!person?.email) {
        unreached(seat.personId);
        continue;
      }
      const delivery = await send(
        db,
        {
          kind: "fly_safe_correction",
          correctionId: crypto.randomUUID(),
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
      if (delivery.status === "sent") {
        outcome.told += 1;
        unsent.delete(seat.id);
        continue;
      }
      // A persisted retry holds the claim while the queue tries it.
      if (delivery.status === "failed" && delivery.retryable && delivery.retryQueued === true) {
        unsent.delete(seat.id);
        outcome.failed += 1;
        continue;
      }
      unreached(seat.personId);
    }
  } finally {
    if (unsent.size > 0) {
      await db
        .update(bookings)
        .set({ flySafeCorrectedAt: null })
        .where(and(eq(bookings.shopId, input.shopId), inArray(bookings.id, [...unsent])));
    }
  }
  return outcome;
}
