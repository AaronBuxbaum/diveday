import { and, asc, count, desc, eq, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import {
  type Notification,
  type NotificationDelivery,
  type NotificationProvider,
  notificationIdempotencyKey,
  notificationProviderFromEnvironment,
  notify,
  publicAppUrl,
} from "@/lib/notifications";
import { ACTIONABLE_PROVIDER_STATUSES, type ProviderEmailStatus } from "@/lib/notifications/events";
import { issueBookingCapability } from "./booking-capabilities";
import type { AppDb } from "./client";
import {
  bookings,
  notificationDeliveries,
  notificationDeliveryAttempts,
  notificationRateLimitState,
  notificationSendQueue,
  people,
  shops,
  trips,
} from "./schema";

const RESEND_REQUEST_INTERVAL_MS = 125;
const RETRY_QUEUE_LIMIT = 100;
const RETRY_QUEUE_MAX_ATTEMPTS = 8;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Reserve one request slot for the whole Resend team. The row lock makes this
 * safe when Vercel has several instances draining or sending at once.
 */
export async function reserveResendRequest(db: AppDb): Promise<void> {
  const now = nowDate();
  const scheduledAt = await db.transaction(async (tx) => {
    await tx
      .insert(notificationRateLimitState)
      .values({ key: "resend", nextAllowedAt: now })
      .onConflictDoNothing();
    const [state] = await tx
      .select()
      .from(notificationRateLimitState)
      .where(eq(notificationRateLimitState.key, "resend"))
      .for("update");
    const nextAllowedAt = Math.max(now.getTime(), state?.nextAllowedAt.getTime() ?? now.getTime());
    await tx
      .update(notificationRateLimitState)
      .set({ nextAllowedAt: new Date(nextAllowedAt + RESEND_REQUEST_INTERVAL_MS) })
      .where(eq(notificationRateLimitState.key, "resend"));
    return nextAllowedAt;
  });
  const delay = scheduledAt - now.getTime();
  if (delay > 0) await wait(delay);
}

/** Use the durable team permit for the default provider; tests may inject a fake. */
export function notificationProviderForDb(
  db: AppDb,
  provider?: NotificationProvider,
): NotificationProvider {
  return (
    provider ??
    notificationProviderFromEnvironment(process.env, fetch, {
      beforeRequest: () => reserveResendRequest(db),
    })
  );
}

function retryDueAt(
  delivery: Extract<NotificationDelivery, { status: "failed" }>,
  attempts: number,
) {
  const fallback = Math.min(60 * 60 * 1_000, 30_000 * 2 ** Math.max(0, attempts - 1));
  const providerDelay = delivery.retryAfterMs ?? fallback;
  return new Date(nowDate().getTime() + Math.max(1_000, providerDelay));
}

async function queueRetry(
  db: AppDb,
  input: Notification,
  delivery: Extract<NotificationDelivery, { status: "failed" }>,
) {
  await db
    .insert(notificationSendQueue)
    .values({
      shopId: input.shopId,
      idempotencyKey: notificationIdempotencyKey(input),
      payload: input,
      status: "queued",
      nextAttemptAt: retryDueAt(delivery, 1),
      httpStatus: delivery.httpStatus ?? null,
      errorCode: delivery.errorCode ?? null,
      lastError: delivery.detail ?? null,
    })
    .onConflictDoNothing({ target: notificationSendQueue.idempotencyKey });
}

/** Send immediately and retain retryable failures for the next worker pass. */
export async function sendNotification(
  db: AppDb,
  input: Notification,
  provider?: NotificationProvider,
): Promise<NotificationDelivery> {
  let delivery: NotificationDelivery;
  try {
    delivery = await notify(input, notificationProviderForDb(db, provider));
  } catch (error) {
    delivery = {
      status: "failed",
      retryable: true,
      errorCode: "provider_error",
      detail: error instanceof Error ? error.message.slice(0, 500) : undefined,
    };
  }
  if (delivery.status === "failed" && delivery.retryable) {
    try {
      await queueRetry(db, input, delivery);
    } catch (error) {
      console.error("Retryable notification could not be queued", {
        kind: input.kind,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }
  return delivery;
}

/**
 * Send a known fan-out through Resend's batch endpoint when available. Batches
 * are capped at 100 by Resend; each returned id remains aligned to its input.
 */
export async function sendNotificationBatch(
  db: AppDb,
  inputs: Notification[],
  provider?: NotificationProvider,
): Promise<NotificationDelivery[]> {
  const resolved = notificationProviderForDb(db, provider);
  const deliveries: NotificationDelivery[] = [];
  for (let offset = 0; offset < inputs.length; offset += 100) {
    const batch = inputs.slice(offset, offset + 100);
    let results: NotificationDelivery[];
    try {
      if (resolved.sendBatch) {
        results = await resolved.sendBatch(batch);
      } else {
        results = [];
        for (const input of batch) results.push(await notify(input, resolved));
      }
    } catch {
      results = batch.map(() => ({ status: "failed" as const, retryable: true }));
    }
    for (let index = 0; index < batch.length; index += 1) {
      const delivery = results[index] ?? { status: "failed" as const, retryable: true };
      deliveries.push(delivery);
      if (delivery.status === "failed" && delivery.retryable) {
        try {
          await queueRetry(db, batch[index], delivery);
        } catch (error) {
          console.error("Retryable notification could not be queued", {
            kind: batch[index].kind,
            error: error instanceof Error ? error.message : "unknown_error",
          });
        }
      }
    }
  }
  return deliveries;
}

function reviveQueuedNotification(payload: Notification): Notification {
  const copy = { ...payload } as Record<string, unknown>;
  for (const field of [
    "startsAt",
    "endsAt",
    "expiresAt",
    "invitedAt",
    "changedAt",
    "confirmedAt",
  ]) {
    if (typeof copy[field] === "string") copy[field] = new Date(copy[field]);
  }
  return copy as Notification;
}

export type NotificationRetrySummary = {
  scanned: number;
  sent: number;
  queued: number;
  failed: number;
};

/** Drain durable transient failures; safe for overlapping cron invocations. */
export async function drainNotificationRetries(
  db: AppDb,
  options: { now?: Date; limit?: number; provider?: NotificationProvider } = {},
): Promise<NotificationRetrySummary> {
  const now = options.now ?? nowDate();
  const candidates = await db
    .select()
    .from(notificationSendQueue)
    .where(
      and(
        eq(notificationSendQueue.status, "queued"),
        lte(notificationSendQueue.nextAttemptAt, now),
        or(isNull(notificationSendQueue.lockedUntil), lt(notificationSendQueue.lockedUntil, now)),
      ),
    )
    .orderBy(asc(notificationSendQueue.nextAttemptAt))
    .limit(options.limit ?? RETRY_QUEUE_LIMIT);
  const summary: NotificationRetrySummary = {
    scanned: candidates.length,
    sent: 0,
    queued: 0,
    failed: 0,
  };
  if (candidates.length === 0) return summary;
  const provider = notificationProviderForDb(db, options.provider);

  for (const candidate of candidates) {
    const lockedUntil = new Date(now.getTime() + 10 * 60 * 1_000);
    const [claimed] = await db
      .update(notificationSendQueue)
      .set({
        status: "processing",
        attempts: sql`${notificationSendQueue.attempts} + 1`,
        lockedUntil,
        updatedAt: nowDate(),
      })
      .where(
        and(
          eq(notificationSendQueue.id, candidate.id),
          eq(notificationSendQueue.status, "queued"),
          or(isNull(notificationSendQueue.lockedUntil), lt(notificationSendQueue.lockedUntil, now)),
        ),
      )
      .returning();
    if (!claimed) continue;

    const notification = reviveQueuedNotification(candidate.payload);
    let delivery: NotificationDelivery;
    try {
      delivery = await notify(notification, provider);
    } catch (error) {
      delivery = {
        status: "failed",
        retryable: true,
        errorCode: "worker_error",
        detail: error instanceof Error ? error.message.slice(0, 500) : undefined,
      };
    }
    const tracked = "bookingId" in notification ? (notification as TrackedNotification) : null;
    if (tracked) {
      try {
        await recordNotificationDelivery(db, {
          shopId: tracked.shopId,
          bookingId: tracked.bookingId,
          kind: tracked.kind,
          delivery,
          isRetry: true,
        });
      } catch (error) {
        console.error("Notification retry status could not be recorded", {
          bookingId: tracked.bookingId,
          kind: tracked.kind,
          error: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }

    if (delivery.status === "sent") {
      await db
        .update(notificationSendQueue)
        .set({
          status: "sent",
          lockedUntil: null,
          providerMessageId: delivery.providerMessageId,
          updatedAt: nowDate(),
        })
        .where(eq(notificationSendQueue.id, claimed.id));
      summary.sent += 1;
    } else if (
      delivery.status === "failed" &&
      delivery.retryable &&
      claimed.attempts < RETRY_QUEUE_MAX_ATTEMPTS
    ) {
      await db
        .update(notificationSendQueue)
        .set({
          status: "queued",
          lockedUntil: null,
          nextAttemptAt: retryDueAt(delivery, claimed.attempts),
          httpStatus: delivery.httpStatus ?? null,
          errorCode: delivery.errorCode ?? null,
          lastError: delivery.detail ?? null,
          updatedAt: nowDate(),
        })
        .where(eq(notificationSendQueue.id, claimed.id));
      summary.queued += 1;
    } else {
      await db
        .update(notificationSendQueue)
        .set({
          status: "failed",
          lockedUntil: null,
          httpStatus: delivery.status === "failed" ? (delivery.httpStatus ?? null) : null,
          errorCode: delivery.status === "failed" ? (delivery.errorCode ?? null) : null,
          lastError: delivery.status === "failed" ? (delivery.detail ?? null) : null,
          updatedAt: nowDate(),
        })
        .where(eq(notificationSendQueue.id, claimed.id));
      summary.failed += 1;
    }
  }
  return summary;
}

/**
 * Notifications whose delivery is tracked per booking. Waitlist invites are not
 * here: they have no booking, so their record is the entry's `invitedAt` stamp,
 * not a `notification_deliveries` row.
 */
type TrackedNotification = Extract<Notification, { bookingId: string }>;
type TrackedNotificationKind = TrackedNotification["kind"];

type RecordNotificationDeliveryInput = {
  shopId: string;
  bookingId: string;
  kind: TrackedNotificationKind;
  delivery: NotificationDelivery;
  isRetry?: boolean;
};

/**
 * Keep the last delivery result for each booking and purpose, and append the
 * attempt to the durable history. The booking check makes the persistence seam
 * tenant-safe even when invoked outside a route action.
 */
export async function recordNotificationDelivery(
  db: AppDb,
  input: RecordNotificationDeliveryInput,
) {
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  if (!booking) return null;

  const attemptedAt = nowDate();
  const providerMessageId =
    input.delivery.status === "sent" ? input.delivery.providerMessageId : null;
  const sendHttpStatus =
    input.delivery.status === "failed" ? (input.delivery.httpStatus ?? null) : null;
  const sendErrorCode =
    input.delivery.status === "failed" ? (input.delivery.errorCode ?? null) : null;
  const sendError = input.delivery.status === "failed" ? (input.delivery.detail ?? null) : null;
  const latest = {
    shopId: input.shopId,
    bookingId: booking.id,
    kind: input.kind,
    status: input.delivery.status,
    providerMessageId,
    // A fresh send starts a fresh provider story: the previous message's
    // bounce must not be shown against the replacement we just sent.
    providerStatus: null,
    providerStatusAt: null,
    providerDetail: null,
    sendHttpStatus,
    sendErrorCode,
    sendError,
    attemptedAt,
  };
  const [record] = await db
    .insert(notificationDeliveries)
    .values(latest)
    .onConflictDoUpdate({
      target: [notificationDeliveries.bookingId, notificationDeliveries.kind],
      set: latest,
    })
    .returning();
  // Append-only history: never fails the caller, but records every attempt.
  await db.insert(notificationDeliveryAttempts).values({
    shopId: input.shopId,
    bookingId: booking.id,
    kind: input.kind,
    status: input.delivery.status,
    providerMessageId,
    sendHttpStatus,
    sendErrorCode,
    sendError,
    isRetry: input.isRetry ?? false,
    attemptedAt,
  });
  return record ?? null;
}

/**
 * Outbound email is best-effort, but its latest result is durable enough for
 * staff to notice an issue. A tracking write failure must not alter the
 * booking or waiver operation that triggered it.
 */
export async function sendAndRecordNotification(
  db: AppDb,
  input: TrackedNotification,
  options: { isRetry?: boolean } = {},
) {
  let delivery: NotificationDelivery;
  try {
    delivery = await sendNotification(db, input);
  } catch {
    delivery = { status: "failed" };
  }

  try {
    await recordNotificationDelivery(db, {
      shopId: input.shopId,
      bookingId: input.bookingId,
      kind: input.kind,
      delivery,
      isRetry: options.isRetry,
    });
  } catch {
    console.error("Notification delivery status could not be recorded", {
      bookingId: input.bookingId,
      kind: input.kind,
    });
  }
  return delivery;
}

/**
 * Re-send a booking confirmation from stored booking/trip/shop data. Only
 * confirmations are retryable: a waiver link's one-time token is never stored,
 * so re-sending a waiver means issuing a fresh link, not a retry.
 */
export async function retryBookingConfirmation(db: AppDb, shopId: string, bookingId: string) {
  const [row] = await db
    .select({ booking: bookings, person: people, trip: trips, shop: shops })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .limit(1);
  if (!row?.person.email) return null;
  const origin = publicAppUrl();
  const readinessCapability = origin
    ? await issueBookingCapability(db, {
        shopId,
        bookingId: row.booking.id,
        purpose: "readiness",
      })
    : null;
  return sendAndRecordNotification(
    db,
    {
      kind: "booking_confirmation",
      bookingId: row.booking.id,
      shopId,
      to: row.person.email,
      diverName: row.person.fullName,
      shopName: row.shop.name,
      tripTitle: row.trip.title,
      startsAt: row.trip.startsAt,
      endsAt: row.trip.endsAt,
      timezone: row.shop.timezone,
      dockCallMinutes: row.shop.dockCallMinutes,
      readinessUrl: readinessCapability
        ? new URL(readinessLinkPath(readinessCapability.token), `${origin}/`).toString()
        : undefined,
      // A staff-triggered resend is a new logical send, not a replay of the
      // original booking confirmation's provider idempotency key.
      confirmedAt: nowDate(),
    },
    { isRetry: true },
  );
}

export type ApplyProviderEmailEventResult = "applied" | "stale" | "unknown_message";

/**
 * Files a provider-reported outcome against the message it belongs to, found
 * by the provider's own id (20260726-hosted-mailboxes-for-platform-mail).
 *
 * Two things make this deliberately forgiving. Webhook delivery is
 * at-least-once and unordered, so an older event arriving after a newer one is
 * normal and is dropped as `stale` rather than allowed to overwrite. And a
 * message id we don't recognise — a waitlist invite, which keeps no delivery
 * row, or mail sent from the Resend dashboard — is `unknown_message`, not an
 * error: the endpoint has no business failing over an event about a message it
 * never tracked.
 *
 * Not tenant-scoped by argument, because a webhook carries no tenant: the
 * provider message id, minted by Resend per send, *is* the scope. It reaches
 * exactly the row that recorded that send.
 */
export async function applyProviderEmailEvent(
  db: AppDb,
  input: {
    providerMessageId: string;
    status: ProviderEmailStatus;
    detail: string | null;
    occurredAt: Date;
  },
): Promise<ApplyProviderEmailEventResult> {
  const [existing] = await db
    .select({ id: notificationDeliveries.id, statusAt: notificationDeliveries.providerStatusAt })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.providerMessageId, input.providerMessageId))
    .limit(1);
  if (!existing) return "unknown_message";
  if (existing.statusAt && existing.statusAt > input.occurredAt) return "stale";

  await db
    .update(notificationDeliveries)
    .set({
      providerStatus: input.status,
      providerStatusAt: input.occurredAt,
      providerDetail: input.detail,
    })
    .where(eq(notificationDeliveries.id, existing.id));
  return "applied";
}

/**
 * Open email issues for the staff dashboard; cancelled bookings need no
 * follow-up. An issue is either a send that never left (`failed`,
 * `not_configured`) or a send the provider later reported went nowhere —
 * a bounce or a spam complaint is invisible at send time and is the more
 * common real-world failure of the two.
 */
export async function listNotificationDeliveryIssues(db: AppDb, shopId: string) {
  return db
    .select({
      delivery: notificationDeliveries,
      booking: bookings,
      person: people,
      trip: trips,
      attempts: count(notificationDeliveryAttempts.id),
    })
    .from(notificationDeliveries)
    .innerJoin(bookings, eq(bookings.id, notificationDeliveries.bookingId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .leftJoin(
      notificationDeliveryAttempts,
      and(
        eq(notificationDeliveryAttempts.bookingId, notificationDeliveries.bookingId),
        eq(notificationDeliveryAttempts.kind, notificationDeliveries.kind),
      ),
    )
    .where(
      and(
        eq(notificationDeliveries.shopId, shopId),
        or(
          inArray(notificationDeliveries.status, ["failed", "not_configured"]),
          inArray(notificationDeliveries.providerStatus, ACTIONABLE_PROVIDER_STATUSES),
        ),
        ne(bookings.status, "cancelled"),
      ),
    )
    .groupBy(notificationDeliveries.id, bookings.id, people.id, trips.id)
    .orderBy(desc(notificationDeliveries.attemptedAt));
}

/** The full attempt trail for one booking/purpose, oldest first. */
export async function listDeliveryAttempts(
  db: AppDb,
  shopId: string,
  bookingId: string,
  kind: TrackedNotificationKind,
) {
  return db
    .select()
    .from(notificationDeliveryAttempts)
    .where(
      and(
        eq(notificationDeliveryAttempts.shopId, shopId),
        eq(notificationDeliveryAttempts.bookingId, bookingId),
        eq(notificationDeliveryAttempts.kind, kind),
      ),
    )
    .orderBy(asc(notificationDeliveryAttempts.attemptedAt));
}
