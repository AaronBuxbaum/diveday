import { createHash } from "node:crypto";
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import {
  type Notification,
  type NotificationDelivery,
  type NotificationProvider,
  recipientLocale,
} from "@/lib/notifications";
import type { AppDb, DbExecutor } from "./client";
import {
  type FlySafeExposure,
  openFlySafeExposures,
  sealFlySafeExposures,
} from "./fly-safe-exposures";
import { readReminderFlySafeHours } from "./fly-safe-plan";
import { notificationProviderForDb, sendNotification } from "./notifications";
import { queryAll } from "./query-helpers";
import { bookings, notificationSendQueue, people, shops, trips } from "./schema";
import { livePerson, liveTrip, notRehearsal } from "./trips-live";

/**
 * Correct an interval that no longer matches the diver's current itinerary.
 * The provider's actual recipient is sealed with shop and seat identifiers;
 * legacy or unreadable snapshots are left for staff to follow up.
 */

/** Seats still on the boat: the ones a correction speaks to. */
const LIVE_SEAT_STATUSES = ["booked", "checked_in"] as const;

/**
 * How long after the boat is due back a correction is still worth sending:
 * the longest wait the night-before email can say (`flySafeHours`, at most 48).
 * Past it, every figure the diver was told has run out on its own.
 */
export const FLY_SAFE_CORRECTION_WINDOW_MS = 48 * HOUR_MS;

/** Expired workers may be retried; provider acceptance can therefore be duplicated after a crash. */
export const FLY_SAFE_CORRECTION_LEASE_MS = 15 * 60 * 1000;
const MAX_AUTOMATIC_CORRECTION_CLAIMS = 3;
const FLY_SAFE_QUERY_CONCURRENCY = 4;

/** Preserve input order while keeping database-backed work to a small fixed fan-out. */
export async function mapFlySafeConcurrent<T, R>(
  db: DbExecutor,
  items: readonly T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const indexedItems = items.map((item, index) => ({ item, index }));
  const limit = Math.max(1, concurrency);
  for (let start = 0; start < indexedItems.length; start += limit) {
    const batch = indexedItems.slice(start, start + limit);
    const batchResults = await queryAll(
      db,
      batch.map(
        ({ item, index }) =>
          () =>
            work(item, index),
      ),
    );
    for (let offset = 0; offset < batch.length; offset += 1) {
      const entry = batch[offset];
      if (entry) results[entry.index] = batchResults[offset] as R;
    }
  }
  return results;
}

/** The night-before email went out carrying the fly-safe line: remember what it said. */
export async function recordFlySafeTold(
  db: DbExecutor,
  input: {
    shopId: string;
    bookingId: string;
    hours: number;
    recipientEmail?: string;
    recipientPersonId?: string;
    exposureId?: string;
    accepted?: boolean;
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      // diveday:allow-update-lock: serialize exposure recording with seat erasure and identity repointing.
      .for("update");
    if (!locked) return false;
    // Erasure must lock and clear this seat before it commits. A non-locking
    // person read here cannot deadlock with its person-first lock order.
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.id, locked.personId),
          eq(people.shopId, input.shopId),
          livePerson(),
          isNull(people.anonymizedAt),
        ),
      )
      .limit(1);
    if (!person) return false;
    const reassigned = !!input.recipientPersonId && input.recipientPersonId !== person.id;
    if (reassigned) {
      await tx
        .update(bookings)
        .set({
          flySafeRecipientSealed: null,
          flySafeRecipientUnknown: true,
          flySafeHoursTold: input.hours,
          flySafeCorrectedAt: null,
          flySafeCorrectionId: null,
          flySafeCorrectionLeaseId: null,
          flySafeCorrectionLeaseUntil: null,
        })
        .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)));
      return false;
    }
    if (!input.recipientEmail) return false;
    const previous = locked.flySafeRecipientSealed
      ? openFlySafeExposures(locked.flySafeRecipientSealed, input.shopId, input.bookingId)
      : [];
    if (!previous) return false;
    const exposureId = input.exposureId ?? crypto.randomUUID();
    const existing = previous.find((exposure) => exposure.id === exposureId);
    if (existing) {
      if (input.accepted && !existing.accepted) {
        existing.accepted = true;
        const updated = sealFlySafeExposures(previous, input.shopId, input.bookingId);
        if (!updated) return false;
        await tx
          .update(bookings)
          .set({ flySafeRecipientSealed: updated })
          .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)));
      }
      return true;
    }
    const exposure: FlySafeExposure = {
      id: exposureId,
      email: input.recipientEmail,
      hours: input.hours,
      correctionId: null,
      corrected: false,
      accepted: input.accepted ?? true,
    };
    const sealed = sealFlySafeExposures([...previous, exposure], input.shopId, input.bookingId);
    if (!sealed) return false;
    await tx
      .update(bookings)
      .set({
        flySafeHoursTold: input.hours,
        flySafeRecipientSealed: sealed,
        flySafeRecipientUnknown:
          locked.flySafeRecipientUnknown ||
          (locked.flySafeHoursTold !== null && !locked.flySafeRecipientSealed),
        flySafeCorrectedAt: null,
        flySafeCorrectionId: null,
        flySafeCorrectionAttempts: 0,
        flySafeCorrectionLeaseId: null,
        flySafeCorrectionLeaseUntil: null,
      })
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.personId, person.id),
        ),
      );
    return true;
  });
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
    recipientEmail: notification.personId ? notification.to : undefined,
    recipientPersonId: notification.personId,
    exposureId: notification.flySafeExposureId,
    accepted: input.delivery.status === "sent",
  });
}

/** Persist a possible exposure before crossing the provider boundary. */
export async function prepareFlySafeExposure(
  db: AppDb,
  notification: Notification,
): Promise<Notification> {
  if (notification.kind !== "trip_reminder_24h" || notification.flySafeHours === undefined)
    return notification;
  const id = notification.flySafeExposureId ?? crypto.randomUUID();
  const candidate = { ...notification, flySafeExposureId: id };
  try {
    if (
      candidate.personId &&
      (await recordFlySafeTold(db, {
        shopId: candidate.shopId,
        bookingId: candidate.bookingId,
        hours: notification.flySafeHours,
        recipientEmail: candidate.to,
        recipientPersonId: candidate.personId,
        exposureId: id,
        accepted: false,
      }))
    )
      return candidate;
  } catch (error) {
    log("reminder.fly_safe_exposure_record_failed", "error", {
      shopId: candidate.shopId,
      bookingId: candidate.bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
  }
  const { flySafeHours: _hours, ...withoutHours } = candidate;
  return { ...withoutHours, flySafeAskCrew: true };
}

/** Remove a pre-send reservation when the provider definitively refused it. */
export async function discardRefusedFlySafeExposure(
  db: AppDb,
  notification: Notification,
): Promise<void> {
  if (notification.kind !== "trip_reminder_24h" || !notification.flySafeExposureId) return;
  await db.transaction(async (tx) => {
    const [seat] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, notification.bookingId), eq(bookings.shopId, notification.shopId)))
      // diveday:allow-update-lock: retract only this refused reminder reservation.
      .for("update");
    if (!seat?.flySafeRecipientSealed) return;
    const entries = openFlySafeExposures(
      seat.flySafeRecipientSealed,
      notification.shopId,
      notification.bookingId,
    );
    if (!entries) return;
    const exposure = entries.find((entry) => entry.id === notification.flySafeExposureId);
    if (!exposure || exposure.corrected || exposure.correctionId) return;
    const remaining = entries.filter((entry) => entry.id !== notification.flySafeExposureId);
    const sealed = remaining.length
      ? sealFlySafeExposures(remaining, notification.shopId, notification.bookingId)
      : null;
    if (remaining.length && !sealed) return;
    await tx
      .update(bookings)
      .set({
        flySafeRecipientSealed: sealed,
        flySafeHoursTold:
          remaining.at(-1)?.hours ?? (seat.flySafeRecipientUnknown ? seat.flySafeHoursTold : null),
      })
      .where(
        and(eq(bookings.id, notification.bookingId), eq(bookings.shopId, notification.shopId)),
      );
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
        liveTrip(),
        notRehearsal(),
        gte(trips.endsAt, new Date(input.now.getTime() - FLY_SAFE_CORRECTION_WINDOW_MS)),
      ),
    );
  for (const trip of due) {
    try {
      const outcome = await sendFlySafeCorrections(db, { ...trip, ...input, automatic: true });
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

/** Recheck the current seats of the affected people after an itinerary change. */
async function correctFlySafeForPeople(
  db: AppDb,
  input: { shopId: string; personIds: string[]; now?: Date; emailProvider?: NotificationProvider },
): Promise<FlySafeCorrectionOutcome> {
  const total: FlySafeCorrectionOutcome = { told: 0, failed: 0, unreached: [] };
  if (!input.personIds.length) return total;
  const seats = await db
    .select({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        inArray(bookings.personId, input.personIds),
        inArray(bookings.status, [...LIVE_SEAT_STATUSES]),
        isNotNull(bookings.flySafeHoursTold),
        isNull(bookings.flySafeCorrectedAt),
      ),
    );
  for (const seat of seats) {
    const result = await sendFlySafeCorrections(db, {
      shopId: input.shopId,
      tripId: seat.tripId,
      bookingId: seat.id,
      expectedPersonId: seat.personId,
      now: input.now,
      emailProvider: input.emailProvider,
    });
    total.told += result.told;
    total.failed += result.failed;
    total.unreached.push(...result.unreached);
  }
  return total;
}

/** Recheck every current seat of people whose itinerary includes a changed trip. */
export async function correctFlySafeForTripChange(
  db: AppDb,
  input: { shopId: string; tripId: string; now?: Date; emailProvider?: NotificationProvider },
): Promise<FlySafeCorrectionOutcome> {
  const affected = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(and(eq(bookings.shopId, input.shopId), eq(bookings.tripId, input.tripId)));
  return correctFlySafeForPeople(db, {
    ...input,
    personIds: [...new Set(affected.map((seat) => seat.personId))],
  });
}

/** A moved seat changes both its former and new itinerary, not just its own reminder. */
export async function correctFlySafeForPerson(
  db: AppDb,
  input: { shopId: string; personId: string; now?: Date; emailProvider?: NotificationProvider },
): Promise<FlySafeCorrectionOutcome> {
  return correctFlySafeForPeople(db, { ...input, personIds: [input.personId] });
}

/** Recheck the recipient provenance before a queued correction reaches a provider. */
export async function queuedFlySafeCorrectionState(
  db: DbExecutor,
  notification: Extract<Notification, { kind: "fly_safe_correction" }>,
): Promise<"valid" | "stale" | "unavailable"> {
  const [seat] = await db
    .select({ sealed: bookings.flySafeRecipientSealed })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, bookings.shopId)))
    .where(
      and(
        eq(bookings.id, notification.seatId),
        eq(bookings.shopId, notification.shopId),
        inArray(bookings.status, [...LIVE_SEAT_STATUSES]),
        livePerson(),
        isNull(people.anonymizedAt),
      ),
    )
    .limit(1);
  if (!seat) return "stale";
  if (!notification.correctionId) {
    await db
      .update(bookings)
      .set({ flySafeRecipientUnknown: true, flySafeCorrectedAt: null })
      .where(
        and(
          eq(bookings.id, notification.seatId),
          eq(bookings.shopId, notification.shopId),
          isNotNull(bookings.flySafeHoursTold),
        ),
      );
    return "stale";
  }
  if (!seat.sealed) return "stale";
  const entries = openFlySafeExposures(seat.sealed, notification.shopId, notification.seatId);
  if (!entries) return "unavailable";
  return entries.some(
    (entry) => entry.correctionId === notification.correctionId && entry.email === notification.to,
  )
    ? "valid"
    : "stale";
}

/** A rejected outbox row can only re-arm the recommendation it belongs to. */
export async function rearmFailedFlySafeCorrection(
  db: DbExecutor,
  input: { shopId: string; bookingId: string; correctionId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [seat] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.shopId, input.shopId), eq(bookings.id, input.bookingId)))
      // diveday:allow-update-lock: fence a rejected outbox generation against new exposures and workers.
      .for("update");
    if (!seat) return;
    const entries = seat.flySafeRecipientSealed
      ? openFlySafeExposures(seat.flySafeRecipientSealed, input.shopId, input.bookingId)
      : null;
    const exposure = entries?.find((value) => value.correctionId === input.correctionId);
    if (!exposure && seat.flySafeCorrectionId !== input.correctionId) return;
    if (exposure) {
      exposure.corrected = false;
      exposure.correctionId = null;
    }
    const sealed = entries ? sealFlySafeExposures(entries, input.shopId, input.bookingId) : null;
    await tx
      .update(bookings)
      .set({
        flySafeCorrectedAt: null,
        flySafeRecipientSealed: sealed ?? seat.flySafeRecipientSealed,
        flySafeRecipientUnknown: seat.flySafeRecipientUnknown || !entries || !sealed,
        ...(seat.flySafeCorrectionId === input.correctionId
          ? {
              flySafeCorrectionId: null,
              flySafeCorrectionLeaseId: null,
              flySafeCorrectionLeaseUntil: null,
            }
          : {}),
      })
      .where(and(eq(bookings.shopId, input.shopId), eq(bookings.id, input.bookingId)));
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

/**
 * What a pass did: how many corrections went, how many did not go now
 * (`failed`, which counts a send queued for the next pass), and the divers it
 * could not reach at all (no address, a refused send), by name, so the
 * staffer who ticked the box knows whom to call.
 */
export type FlySafeCorrectionOutcome = { told: number; failed: number; unreached: string[] };

/** Staff-visible state, derived from the durable queue and exposure ledger. */
async function readFlySafeFollowUps(
  db: DbExecutor,
  input: { shopId: string; tripId: string; includeAcknowledged?: boolean },
): Promise<
  { bookingId: string; name: string; status: "queued" | "follow_up"; fingerprint: string }[]
> {
  const [trip] = await db
    .select({ trip: trips, shop: shops })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(
      and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip(), notRehearsal()),
    )
    .limit(1);
  if (!trip) return [];
  const seats = await db
    .select({
      id: bookings.id,
      personId: bookings.personId,
      participantType: bookings.participantType,
      name: people.fullName,
      sealed: bookings.flySafeRecipientSealed,
      unknown: bookings.flySafeRecipientUnknown,
      acknowledged: bookings.flySafeAcknowledgementFingerprint,
    })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, input.shopId)))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, input.tripId),
        isNotNull(bookings.flySafeHoursTold),
        livePerson(),
        isNull(people.anonymizedAt),
      ),
    );
  const entriesBySeat = seats.map((seat) => ({
    seat,
    entries: seat.sealed ? openFlySafeExposures(seat.sealed, input.shopId, seat.id) : null,
  }));
  const keys = entriesBySeat.flatMap(({ seat, entries }) =>
    (entries ?? [])
      .filter((entry) => entry.correctionId)
      .map((entry) => `fly-safe-correction/${seat.id}/${entry.correctionId}`),
  );
  const queued = keys.length
    ? await db
        .select({ key: notificationSendQueue.idempotencyKey, status: notificationSendQueue.status })
        .from(notificationSendQueue)
        .where(
          and(
            eq(notificationSendQueue.shopId, input.shopId),
            inArray(notificationSendQueue.idempotencyKey, keys),
          ),
        )
    : [];
  const queueByKey = new Map(queued.map((row) => [row.key, row.status]));
  const resultBySeat = await mapFlySafeConcurrent(
    db,
    entriesBySeat,
    FLY_SAFE_QUERY_CONCURRENCY,
    async ({ seat, entries }) => {
      const hours = await readReminderFlySafeHours(db, {
        shop: { id: input.shopId },
        person: { id: seat.personId },
        participantType: seat.participantType,
        detail: {
          shop: { timezone: trip.shop.timezone },
          trip: { id: trip.trip.id, startsAt: trip.trip.startsAt },
        },
      });
      let pending = false;
      let followUp = seat.unknown || !entries;
      const affected: string[] = [];
      for (const entry of entries ?? []) {
        const state = entry.correctionId
          ? queueByKey.get(`fly-safe-correction/${seat.id}/${entry.correctionId}`)
          : undefined;
        if (state === "queued" || state === "processing") {
          pending = true;
          affected.push(entry.id);
        } else if (
          (state === "failed" && entry.corrected) ||
          (!entry.corrected && entry.hours !== hours)
        ) {
          followUp = true;
          affected.push(entry.id);
        }
      }
      if (followUp || pending) {
        const fingerprint = createHash("sha256")
          .update(JSON.stringify([seat.personId, hours, seat.unknown || !entries, affected.sort()]))
          .digest("hex");
        if (input.includeAcknowledged || seat.acknowledged !== fingerprint)
          return {
            bookingId: seat.id,
            name: seat.name,
            status: followUp ? ("follow_up" as const) : ("queued" as const),
            fingerprint,
          };
      }
      return null;
    },
  );
  return resultBySeat.filter((item): item is NonNullable<typeof item> => item !== null);
}

/** Trip-specific view, without the acknowledgement token. */
export async function listFlySafeFollowUps(
  db: AppDb,
  input: { shopId: string; tripId: string; now?: Date },
) {
  return (await readFlySafeFollowUps(db, input)).map(
    ({ fingerprint: _fingerprint, ...item }) => item,
  );
}

/** Resolve only the exact state the staff member reviewed; never mark email as delivered. */
export async function acknowledgeFlySafeFollowUp(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    actorPersonId: string;
    fingerprint: string;
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [actor] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.id, input.actorPersonId),
          eq(people.shopId, input.shopId),
          livePerson(),
          isNull(people.anonymizedAt),
        ),
      )
      .limit(1)
      // A shared lock blocks erasure but is compatible with identity repointing's person reads.
      .for("share");
    if (!actor) return false;
    const [seat] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      // diveday:allow-update-lock: fence the reviewed exposure state against concurrent ledger changes and erasure.
      .for("update");
    if (!seat) return false;
    const task = (
      await readFlySafeFollowUps(tx, {
        shopId: input.shopId,
        tripId: seat.tripId,
        includeAcknowledged: true,
      })
    ).find((item) => item.bookingId === seat.id);
    if (!task || task.fingerprint !== input.fingerprint) return false;
    await tx
      .update(bookings)
      .set({
        flySafeAcknowledgementFingerprint: task.fingerprint,
        flySafeAcknowledgedAt: nowDate(),
        flySafeAcknowledgedByPersonId: actor.id,
      })
      .where(and(eq(bookings.id, seat.id), eq(bookings.shopId, input.shopId)));
    return true;
  });
}

/** Show the same follow-up list on every trip, including the trip that triggered a change. */
export async function listShopFlySafeFollowUps(db: AppDb, input: { shopId: string; now?: Date }) {
  const candidates = await db
    .selectDistinct({ id: trips.id, title: trips.title })
    .from(trips)
    .innerJoin(bookings, and(eq(bookings.tripId, trips.id), eq(bookings.shopId, input.shopId)))
    .where(
      and(
        eq(trips.shopId, input.shopId),
        liveTrip(),
        notRehearsal(),
        isNotNull(bookings.flySafeHoursTold),
      ),
    );
  const groups = await mapFlySafeConcurrent(
    db,
    candidates,
    FLY_SAFE_QUERY_CONCURRENCY,
    async (trip) =>
      (await readFlySafeFollowUps(db, { shopId: input.shopId, tripId: trip.id })).map((item) => ({
        ...item,
        tripId: trip.id,
        tripTitle: trip.title,
      })),
  );
  return groups.flat();
}

/**
 * **Send each diver told a fly-safe wait the one correction** (issue #2927).
 *
 * Only for a live, scheduled, non-rehearsal departure within the 48-hour
 * window, and a live seat whose recorded interval differs from the current
 * full-itinerary plan or no longer has a numeric plan. The correction goes
 * to the protected original reminder recipient, including held seats.
 *
 * A lease prevents concurrent workers from sending the same correction. A
 * crashed worker's lease expires; a crash after provider acceptance may send
 * a duplicate. The corrected timestamp is written only after acceptance or
 * confirmed queue persistence, and a token fences a superseded worker.
 */
export async function sendFlySafeCorrections(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    /** Limit a move or reminder reconciliation to the affected seat. */
    bookingId?: string;
    /** Fence a seat discovered for a particular person against reassignment. */
    expectedPersonId?: string;
    /** Limit background retries; an explicit staff action may try again. */
    automatic?: boolean;
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
  if (row?.trip.status !== "scheduled") return outcome;
  // diveday:allow-departure-offset: the longest fly-safe wait after the boat is due back, not a lateness grace.
  if (now.getTime() > row.trip.endsAt.getTime() + FLY_SAFE_CORRECTION_WINDOW_MS) return outcome;
  const { trip, shop } = row;

  // A held seat is corrected too, using the original recipient snapshot.
  const owed = await db
    .select({
      id: bookings.id,
      personId: bookings.personId,
      participantType: bookings.participantType,
      hours: bookings.flySafeHoursTold,
      recipient: bookings.flySafeRecipientSealed,
      unknown: bookings.flySafeRecipientUnknown,
    })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, input.shopId)))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, trip.id),
        input.bookingId ? eq(bookings.id, input.bookingId) : undefined,
        input.expectedPersonId ? eq(bookings.personId, input.expectedPersonId) : undefined,
        inArray(bookings.status, [...LIVE_SEAT_STATUSES]),
        isNotNull(bookings.flySafeHoursTold),
        isNull(bookings.flySafeCorrectedAt),
        livePerson(),
      ),
    );
  const plans = new Map<string, number | null>();
  const stale: string[] = [];
  const plansForSeats = await mapFlySafeConcurrent(
    db,
    owed,
    FLY_SAFE_QUERY_CONCURRENCY,
    async (seat) => {
      const hours = await readReminderFlySafeHours(db, {
        shop: { id: shop.id },
        person: { id: seat.personId },
        participantType: seat.participantType,
        detail: {
          shop: { timezone: shop.timezone },
          trip: { id: trip.id, startsAt: trip.startsAt },
        },
      });
      const entries = seat.recipient
        ? openFlySafeExposures(seat.recipient, shop.id, seat.id)
        : null;
      if (
        seat.unknown ||
        !entries ||
        entries.some((entry) => !entry.corrected && entry.hours !== hours)
      ) {
        return { id: seat.id, hours };
      }
      return null;
    },
  );
  for (const plan of plansForSeats) {
    if (plan) {
      stale.push(plan.id);
      plans.set(plan.id, plan.hours);
    }
  }
  if (stale.length === 0) return outcome;
  const leaseId = crypto.randomUUID();
  const claimed = await db
    .update(bookings)
    .set({
      flySafeCorrectionLeaseId: leaseId,
      flySafeCorrectionId: leaseId,
      flySafeCorrectionLeaseUntil: new Date(now.getTime() + FLY_SAFE_CORRECTION_LEASE_MS),
      flySafeCorrectionAttempts: sql`${bookings.flySafeCorrectionAttempts} + 1`,
    })
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, trip.id),
        input.expectedPersonId ? eq(bookings.personId, input.expectedPersonId) : undefined,
        inArray(bookings.status, [...LIVE_SEAT_STATUSES]),
        isNotNull(bookings.flySafeHoursTold),
        inArray(bookings.id, stale),
        isNull(bookings.flySafeCorrectedAt),
        input.automatic
          ? lt(bookings.flySafeCorrectionAttempts, MAX_AUTOMATIC_CORRECTION_CLAIMS)
          : undefined,
        or(
          isNull(bookings.flySafeCorrectionLeaseUntil),
          lte(bookings.flySafeCorrectionLeaseUntil, now),
        ),
      ),
    )
    .returning({
      id: bookings.id,
      personId: bookings.personId,
      recipient: bookings.flySafeRecipientSealed,
    });
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
  const mutate = async (
    seatId: string,
    change: (entries: FlySafeExposure[]) => void,
    finish = false,
  ) =>
    db.transaction(async (tx) => {
      const [seat] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, seatId), eq(bookings.shopId, shop.id)))
        // diveday:allow-update-lock: serialize exposure receipt with a reminder or terminal outbox retry.
        .for("update");
      if (
        !seat ||
        seat.flySafeCorrectionLeaseId !== leaseId ||
        seat.tripId !== trip.id ||
        (input.expectedPersonId && seat.personId !== input.expectedPersonId) ||
        (seat.status !== "booked" && seat.status !== "checked_in") ||
        !seat.flySafeRecipientSealed
      )
        return false;
      const entries = openFlySafeExposures(seat.flySafeRecipientSealed, shop.id, seatId);
      if (!entries) return false;
      change(entries);
      const sealed = sealFlySafeExposures(entries, shop.id, seatId);
      if (!sealed) return false;
      await tx
        .update(bookings)
        .set({
          flySafeRecipientSealed: sealed,
          ...(finish
            ? {
                flySafeCorrectionLeaseId: null,
                flySafeCorrectionLeaseUntil: null,
                flySafeCorrectedAt:
                  !seat.flySafeRecipientUnknown && entries.every((entry) => entry.corrected)
                    ? now
                    : null,
              }
            : {}),
        })
        .where(
          and(
            eq(bookings.id, seatId),
            eq(bookings.shopId, shop.id),
            eq(bookings.flySafeCorrectionLeaseId, leaseId),
          ),
        );
      return true;
    });
  const unreached = (personId: string) => {
    outcome.failed += 1;
    outcome.unreached.push(personById.get(personId)?.fullName ?? "");
  };
  try {
    for (const seat of claimed) {
      const person = personById.get(seat.personId);
      const entries = seat.recipient
        ? openFlySafeExposures(seat.recipient, shop.id, seat.id)
        : null;
      const plan = plans.get(seat.id);
      if (!person || !entries) {
        unreached(seat.personId);
        continue;
      }
      const [current] = await db
        .select({ unknown: bookings.flySafeRecipientUnknown })
        .from(bookings)
        .where(and(eq(bookings.id, seat.id), eq(bookings.shopId, shop.id)));
      if (current?.unknown) unreached(seat.personId);
      for (const exposure of entries) {
        if (exposure.corrected || exposure.hours === plan) continue;
        if (!exposure.email) {
          unreached(seat.personId);
          continue;
        }
        const correctionId = crypto.randomUUID();
        const prepared = await mutate(seat.id, (values) => {
          const entry = values.find((value) => value.id === exposure.id);
          if (entry && !entry.corrected) entry.correctionId = correctionId;
        });
        if (!prepared) break;
        await db
          .update(bookings)
          .set({ flySafeCorrectionId: correctionId })
          .where(
            and(
              eq(bookings.id, seat.id),
              eq(bookings.shopId, shop.id),
              eq(bookings.flySafeCorrectionLeaseId, leaseId),
            ),
          );
        const delivery = await send(
          db,
          {
            kind: "fly_safe_correction",
            correctionId,
            seatId: seat.id,
            shopId: shop.id,
            to: exposure.email,
            locale: recipientLocale(person.locale, shop.defaultLocale),
            shopName: shop.name,
            tripTitle: trip.title,
            startsAt: trip.startsAt,
            timezone: shop.timezone,
          },
          provider,
        );
        if (
          delivery.status === "sent" ||
          (delivery.status === "failed" && delivery.retryable && delivery.retryQueued === true)
        ) {
          await mutate(seat.id, (values) => {
            const entry = values.find(
              (value) => value.id === exposure.id && value.correctionId === correctionId,
            );
            if (entry) entry.corrected = true;
          });
          if (delivery.status === "sent") outcome.told += 1;
          else outcome.failed += 1;
        } else unreached(seat.personId);
      }
      if (await mutate(seat.id, () => {}, true)) unsent.delete(seat.id);
    }
  } finally {
    if (unsent.size > 0) {
      await db
        .update(bookings)
        .set({ flySafeCorrectionLeaseId: null, flySafeCorrectionLeaseUntil: null })
        .where(
          and(
            eq(bookings.shopId, input.shopId),
            eq(bookings.flySafeCorrectionLeaseId, leaseId),
            inArray(bookings.id, [...unsent]),
          ),
        );
    }
  }
  return outcome;
}
