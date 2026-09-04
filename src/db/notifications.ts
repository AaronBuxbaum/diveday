import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { nowDate, nowMs } from "@/lib/clock";
import {
  DAILY_TICK_INTERVAL_MS,
  dailyPassesWithin,
  nextDailyTickAtOrAfter,
} from "@/lib/cron-schedule";
import { log } from "@/lib/log";
import {
  type Notification,
  type NotificationDelivery,
  type NotificationProvider,
  type NotificationSender,
  notificationIdempotencyKey,
  notificationProviderFromEnvironment,
  notificationSubjectEmail,
  notify,
  publicAppUrl,
  recipientLocale,
  shopSenderOf,
} from "@/lib/notifications";
import { ACTIONABLE_PROVIDER_STATUSES, type ProviderEmailStatus } from "@/lib/notifications/events";
import { openSecret, type SecretKey, sealSecret, secretKeyFromEnvironment } from "@/lib/secret-box";
import { issueBookingCapability } from "./booking-capabilities";
import type { AppDb } from "./client";
import {
  bookings,
  notificationDeliveries,
  notificationDeliveryAttempts,
  notificationSendQueue,
  people,
  shops,
  trips,
  waiverDeliveries,
  waiverRecords,
} from "./schema";

const RETRY_QUEUE_LIMIT = 100;

/** How long a claimed row is held before another pass may take it back. */
const LOCK_MS = 10 * 60 * 1_000;

/**
 * Slack on top of the lock before a `processing` row is handed back. A worker
 * whose lock lapsed one second ago is far more likely to be mid-send than dead,
 * and the cost of guessing wrong is a diver receiving the same message twice.
 */
const LOCK_GRACE_MS = 5 * 60 * 1_000;

/**
 * How long a transient send failure keeps being retried before it is parked
 * for a human.
 *
 * Stated in wall-clock days rather than as an attempt count, because the two
 * are not interchangeable here and confusing them is what OPS-6 found. The
 * previous bound — a bare `8` — was sized for the 30s → 1h ladder below and
 * meant "give up after about two hours". Nothing drains this queue except the
 * daily `/api/cron/reminders` tick, so under the schedule that actually ships
 * the same 8 attempts meant "give up after eight days": a waiver email that
 * SES refused on Monday would still be quietly re-offered the following
 * Tuesday, long after the trip it was for had sailed.
 *
 * Three days is a deliberate figure, not the old one re-derived. A diver-
 * facing message that has not gone out after three daily passes does not need
 * a fourth silent attempt; it needs the staff-visible parked-failure surface,
 * while the trip it concerns is still ahead of the shop. Widen this if a real
 * provider outage ever outlasts it — and widen it here, in days, so the code
 * keeps saying how long it actually waits.
 */
const RETRY_WINDOW_MS = 3 * DAILY_TICK_INTERVAL_MS;

/** Derived, never hand-tuned: one attempt per drain pass inside the window. */
const RETRY_QUEUE_MAX_ATTEMPTS = dailyPassesWithin(RETRY_WINDOW_MS);

/** Use the environment-configured SES provider by default; tests may inject a fake. */
export function notificationProviderForDb(provider?: NotificationProvider): NotificationProvider {
  return provider ?? notificationProviderFromEnvironment();
}

/**
 * When a failed send becomes eligible again.
 *
 * There used to be an exponential ladder here — 30s, doubling, capped at an
 * hour — and it described a system that does not exist. Nothing polls this
 * queue; the only thing that reads `next_attempt_at` is the daily
 * `/api/cron/reminders` pass, so every rung below a day rounded to the same
 * place and the ladder's only observable effect was to make the code look
 * more responsive than it is (OPS-6).
 *
 * What is real: a retry happens on the next daily pass. A provider that asks
 * for longer (SES/SNS `Retry-After`, a throttle telling us to come back in six
 * hours — or in three days) is still obeyed, by snapping forward to the first
 * pass at or after the delay it named, never by retrying sooner than it
 * allowed. `attempts` no longer participates: spacing successive attempts
 * further apart is meaningless when the floor between any two of them is
 * already a day, and pretending otherwise is what produced an eight-day tail.
 */
function retryDueAt(delivery: Extract<NotificationDelivery, { status: "failed" }>) {
  const providerDelay = Math.max(0, delivery.retryAfterMs ?? 0);
  return nextDailyTickAtOrAfter(new Date(nowDate().getTime() + providerDelay));
}

/**
 * The key the queue's payload is sealed under, or `null` when none is set.
 *
 * `SECRET_ENCRYPTION_KEY` is `derived` in `config/env-registry.mjs` — every
 * real deployment gets one from `APP_SECRET_SEED`, and the unit and e2e
 * harnesses set fixed ones. So "no key" means an unconfigured local machine,
 * where nothing is reaching a provider to fail in the first place. It is
 * logged rather than thrown for the reason every other reader of this key
 * degrades: a mis-set key must not take the reminder cron down with it.
 */
function queueSealingKey(where: "queue" | "drain"): SecretKey | null {
  const result = secretKeyFromEnvironment();
  if (result.status === "ok") return result.key;
  // Through `log()`, not `console.error`: only lines written this way are
  // buffered to CloudWatch, and only a `$.event` code can be counted by a
  // metric filter and alarmed on (`infra/lib/observability.ts`). This is the
  // one signal that says a deployment is dropping every retryable
  // notification, so stdout alone is not where it belongs.
  log("notification.queue_seal_unavailable", "error", {
    where,
    reason: result.status === "unset" ? "unset" : result.reason,
  });
  return null;
}

/**
 * Read a sealed payload back, or `null` when it cannot be opened.
 *
 * Three ways that happens, and none of them may be treated as "this row has
 * nothing in it": no key, the wrong key, and a tampered value — AES-GCM
 * authenticates, so a modified ciphertext fails to open rather than decrypting
 * to something that then gets sent. The caller parks the row loudly instead
 * (`sealed_payload_unreadable`), because throwing the notification away on a
 * key rotation is exactly the silent loss this whole queue exists to prevent.
 */
function openQueuedPayload(sealed: string, key: SecretKey): Notification | null {
  const plaintext = openSecret(sealed, key);
  if (plaintext === null) return null;
  try {
    return JSON.parse(plaintext) as Notification;
  } catch {
    return null;
  }
}

/**
 * Persist a retryable failure for the next daily pass.
 *
 * `notification_send_queue.shop_id` is a non-null FK, so this queue is
 * structurally tenant-scoped and a notification with no shop cannot be stored
 * in it. `usage_ceiling_alert` — a platform-level cost warning about the
 * deployment's own Vercel/Neon bill — is the one such kind
 * (ADR 20260806-provider-usage-guardrails), and it deliberately reaches the
 * provider through `notify()` rather than `sendNotification`, so it should
 * never arrive here at all. The guard is a belt-and-braces refusal rather than
 * a code path anyone exercises: inventing a shop id to satisfy the column
 * would attach a platform alert to an arbitrary tenant's row and put it in
 * that tenant's export.
 */
async function queueRetry(
  db: AppDb,
  input: Notification,
  delivery: Extract<NotificationDelivery, { status: "failed" }>,
) {
  if (!("shopId" in input)) return;
  // Sealed before it reaches the column, never after (issue #1297). With no
  // key there is nowhere safe to put a payload carrying a capability URL, and
  // storing one in plaintext to preserve a retry would trade a working
  // credential at rest for a message that was going to be re-sendable by hand
  // anyway. `queueSealingKey` has already said so in the log.
  const key = queueSealingKey("queue");
  if (!key) return;
  await db
    .insert(notificationSendQueue)
    .values({
      shopId: input.shopId,
      idempotencyKey: notificationIdempotencyKey(input),
      payloadSealed: sealSecret(JSON.stringify(input), key),
      // Kept beside the sealed blob, not inside it: legal erasure sweeps on
      // these and cannot read through the seal (issue #1297). `subjectEmail`
      // is the person the message is *about* when that is not the person it is
      // addressed to — two kinds, and `kinds.test.ts` refuses a third that
      // forgets to say so (issue #1298).
      recipientEmail: "to" in input ? input.to : null,
      subjectEmail: notificationSubjectEmail(input),
      bookingId: "bookingId" in input ? (input.bookingId ?? null) : null,
      status: "queued",
      nextAttemptAt: retryDueAt(delivery),
      httpStatus: delivery.httpStatus ?? null,
      errorCode: delivery.errorCode ?? null,
      lastError: delivery.detail ?? null,
    })
    .onConflictDoNothing({ target: notificationSendQueue.idempotencyKey });
}

/**
 * The shop's `Reply-To` and postal footer (ADR
 * 20260902-sender-standards-for-ses), read off the shop row. `undefined` for
 * a shop with neither on file, and for a shop id that matches no row.
 */
export async function shopSenderFor(
  db: AppDb,
  shopId: string,
): Promise<NotificationSender | undefined> {
  const [shop] = await db
    .select({
      contactEmail: shops.contactEmail,
      contactEmailConfirmedAt: shops.contactEmailConfirmedAt,
      addressStreet: shops.addressStreet,
      addressLocality: shops.addressLocality,
      addressRegion: shops.addressRegion,
      addressPostalCode: shops.addressPostalCode,
      addressCountry: shops.addressCountry,
    })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  return shop ? shopSenderOf(shop) : undefined;
}

/**
 * Attach the shop's sender profile to a notification that names a shop and
 * does not already carry one. Resolved here, at the one place every
 * shop-scoped send passes through, rather than by each of the twenty
 * composers — a composer that forgot would silently ship a dead-letter
 * sender. A `cache` lets a fan-out (a deal blast, a retry drain) read each
 * shop once.
 */
async function withShopSender(
  db: AppDb,
  input: Notification,
  cache: Map<string, NotificationSender | undefined> = new Map(),
): Promise<Notification> {
  if (!("shopId" in input) || input.sender) return input;
  if (!cache.has(input.shopId)) cache.set(input.shopId, await shopSenderFor(db, input.shopId));
  const sender = cache.get(input.shopId);
  return sender ? { ...input, sender } : input;
}

/** Send immediately and retain retryable failures for the next worker pass. */
export async function sendNotification(
  db: AppDb,
  input: Notification,
  provider?: NotificationProvider,
): Promise<NotificationDelivery> {
  let delivery: NotificationDelivery;
  try {
    delivery = await notify(await withShopSender(db, input), notificationProviderForDb(provider));
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
 * Send a known fan-out through the provider's batch endpoint when it has one
 * (`NotificationProvider.sendBatch` is optional; SES has none, so this falls
 * back to sending each notification individually). Batches are capped at 100
 * per request; each returned id remains aligned to its input.
 */
export async function sendNotificationBatch(
  db: AppDb,
  inputs: Notification[],
  provider?: NotificationProvider,
): Promise<NotificationDelivery[]> {
  const resolved = notificationProviderForDb(provider);
  const deliveries: NotificationDelivery[] = [];
  const senders = new Map<string, NotificationSender | undefined>();
  for (let offset = 0; offset < inputs.length; offset += 100) {
    const batch = inputs.slice(offset, offset + 100);
    let results: NotificationDelivery[];
    try {
      const addressed: Notification[] = [];
      for (const input of batch) addressed.push(await withShopSender(db, input, senders));
      if (resolved.sendBatch) {
        results = await resolved.sendBatch(addressed);
      } else {
        results = [];
        for (const input of addressed) results.push(await notify(input, resolved));
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
  // The blow-out message carries dates nested inside its alternatives list
  // (docs ADR 20260804-blowout-cascade) — revive those too, or a queued retry
  // fails the kind's own z.date() validation and can never drain.
  if (Array.isArray(copy.alternatives)) {
    copy.alternatives = copy.alternatives.map((alternative: Record<string, unknown>) =>
      typeof alternative?.startsAt === "string"
        ? { ...alternative, startsAt: new Date(alternative.startsAt) }
        : alternative,
    );
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
  // Resolved before anything is claimed, and a `null` ends the pass having
  // touched nothing.
  //
  // This is not a nicety. Every terminal write below is genuinely terminal —
  // nothing anywhere moves a `failed` row back to `queued` — so a pass that ran
  // with an unset or rotated key would claim every due row, fail to open it,
  // and park the lot `failed` for good: every pending waiver link, password
  // reset, staff invite and booking confirmation destroyed by one tick of a
  // misconfigured deploy. Returning here is what makes a restored key a
  // recovery rather than an autopsy, and it costs nothing — a pass with no key
  // could not have sent anything anyway.
  const key = queueSealingKey("drain");
  const summary: NotificationRetrySummary = { scanned: 0, sent: 0, queued: 0, failed: 0 };
  if (!key) return summary;

  // A worker that died between claiming a row and writing its outcome left it
  // `processing` with a lock that has since lapsed, and nothing anywhere put it
  // back: the candidate query below only ever looked for `queued`. That is two
  // losses at once — a notification nobody will ever send again, and, since
  // #1297 sealed it, a payload that never reaches the `payload_sealed = null`
  // every terminal path writes. Hand it back to the queue before selecting, so
  // the ordinary claim below picks it up and its attempt count still bounds it.
  await db
    .update(notificationSendQueue)
    .set({ status: "queued", lockedUntil: null, updatedAt: nowDate() })
    .where(
      and(
        eq(notificationSendQueue.status, "processing"),
        lt(notificationSendQueue.lockedUntil, new Date(now.getTime() - LOCK_GRACE_MS)),
      ),
    );
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
  summary.scanned = candidates.length;
  if (candidates.length === 0) return summary;
  const provider = notificationProviderForDb(options.provider);
  const senders = new Map<string, NotificationSender | undefined>();

  for (const candidate of candidates) {
    // From the wall clock, never from `now` — that is the *pass's* start, and a
    // pass drains up to a hundred rows one network send at a time. Nine minutes
    // in, a row claimed against the pass start would carry a lock with sixty
    // seconds left on it, and the last rows of a slow pass would be claimed
    // already expired — handing a live worker's row to the reclaim above and
    // sending the same message twice.
    const lockedUntil = new Date(nowMs() + LOCK_MS);
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

    if (!candidate.payloadSealed) {
      await db
        .update(notificationSendQueue)
        .set({
          status: "failed",
          lockedUntil: null,
          errorCode: "missing_payload",
          lastError: null,
          updatedAt: nowDate(),
        })
        .where(eq(notificationSendQueue.id, claimed.id));
      summary.failed += 1;
      continue;
    }

    // Reaching here means the key is present and this particular row still will
    // not open: the wrong key, or a value that failed its authentication tag.
    // Neither is recoverable by waiting, so the row is terminal — and it is
    // parked under its own code rather than folded into `missing_payload`
    // because the two describe different faults, and a `failed` row's
    // `error_code` is the only place either is written down. (The recoverable
    // case, no key at all, never gets this far: the pass returned above.)
    const opened = openQueuedPayload(candidate.payloadSealed, key);
    if (!opened) {
      await db
        .update(notificationSendQueue)
        .set({
          status: "failed",
          lockedUntil: null,
          errorCode: "sealed_payload_unreadable",
          lastError: null,
          updatedAt: nowDate(),
        })
        .where(eq(notificationSendQueue.id, claimed.id));
      summary.failed += 1;
      continue;
    }

    const notification = reviveQueuedNotification(opened);
    let delivery: NotificationDelivery;
    try {
      delivery = await notify(await withShopSender(db, notification, senders), provider);
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
    try {
      await recordIndependentWaiverDelivery(db, notification, delivery);
    } catch (error) {
      console.error("Independent waiver delivery status could not be recorded", {
        waiverRecordId:
          notification.kind === "waiver_request" ? notification.waiverRecordId : undefined,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }

    if (delivery.status === "sent") {
      await db
        .update(notificationSendQueue)
        .set({
          status: "sent",
          payloadSealed: null,
          recipientEmail: null,
          subjectEmail: null,
          bookingId: null,
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
          nextAttemptAt: retryDueAt(delivery),
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
          payloadSealed: null,
          recipientEmail: null,
          subjectEmail: null,
          bookingId: null,
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
type TrackedNotificationKind = TrackedNotification["kind"] | "waiver_request";

type RecordNotificationDeliveryInput = {
  shopId: string;
  bookingId: string;
  kind: TrackedNotificationKind;
  delivery: NotificationDelivery;
  isRetry?: boolean;
};

async function recordIndependentWaiverDelivery(
  db: AppDb,
  notification: Notification,
  delivery: NotificationDelivery,
) {
  if (notification.kind !== "waiver_request" || notification.bookingId) return;
  await db
    .update(waiverRecords)
    .set({
      deliveryStatus:
        delivery.status === "sent"
          ? "sent"
          : delivery.status === "not_configured"
            ? "not_configured"
            : "failed",
      deliveryProviderMessageId: delivery.status === "sent" ? delivery.providerMessageId : null,
      deliveryProviderStatus: null,
      deliveryProviderStatusAt: null,
      deliveryError: delivery.status === "failed" ? (delivery.detail ?? null) : null,
    })
    .where(eq(waiverRecords.id, notification.waiverRecordId));
}

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
  input: Notification,
  options: { isRetry?: boolean; provider?: NotificationProvider } = {},
) {
  let delivery: NotificationDelivery;
  try {
    delivery = await sendNotification(db, input, options.provider);
  } catch {
    delivery = { status: "failed" };
  }

  if ("bookingId" in input && input.bookingId) {
    const tracked = input as TrackedNotification;
    try {
      await recordNotificationDelivery(db, {
        shopId: tracked.shopId,
        bookingId: tracked.bookingId,
        kind: tracked.kind,
        delivery,
        isRetry: options.isRetry,
      });
    } catch {
      console.error("Notification delivery status could not be recorded", {
        bookingId: input.bookingId,
        kind: input.kind,
      });
    }
  }
  return delivery;
}

/**
 * Re-send a booking confirmation from stored booking/trip/shop data. Only
 * confirmations are retryable: a waiver link's one-time token is never stored,
 * so re-sending a waiver means issuing a fresh link, not a retry.
 */
export async function retryBookingConfirmation(
  db: AppDb,
  shopId: string,
  bookingId: string,
  provider?: NotificationProvider,
) {
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
      // Staff press the button, but the diver reads the mail — so this is the
      // diver's own recorded locale, never the staff member's request
      // (docs ADR 20260731-per-person-notification-locale).
      locale: recipientLocale(row.person.locale, row.shop.defaultLocale),
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
    { isRetry: true, provider },
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
 * row, or mail sent directly from the AWS SES console — is `unknown_message`,
 * not an error: the endpoint has no business failing over an event about a
 * message it never tracked.
 *
 * Not tenant-scoped by argument, because a webhook carries no tenant: the
 * provider message id, minted by the provider per send, *is* the scope. It
 * reaches exactly the row that recorded that send.
 */
export async function applyProviderEmailEvent(
  db: AppDb,
  input: {
    providerMessageId: string;
    status: ProviderEmailStatus;
    detail: string | null;
    occurredAt: Date;
    /**
     * Restrict the update to one shop's rows.
     *
     * Optional because SES has nothing to scope by — its event names a message
     * id and nothing else, and those ids come from DiveDay's own single
     * account. A provider whose events *do* carry a tenant
     * (WhatsApp names the WhatsApp Business Account) passes it, so a delivery
     * outcome can never land on another shop's row even if a provider message
     * id were ever guessable or reused.
     */
    shopId?: string;
  },
): Promise<ApplyProviderEmailEventResult> {
  // A verdict a shop must chase -- `bounced`, `complained`, `failed` -- is
  // terminal for the send that produced it, and nothing softer may land on top
  // of it. The chronological guard below cannot hold this on its own: SES
  // publishes *both* a `Delivery` and a `Complaint` for the same message (a
  // complaint is by definition delivered first), and the delivery notification
  // can carry the later timestamp. Strict chronology then writes `delivered`
  // over `complained`, and because `listNotificationDeliveryIssues` reads
  // `providerStatus`, the complaint silently stops being an email issue on the
  // shop's dashboard -- the one place a shop would ever learn of it. Seen in
  // production on 2026-09-02 against the mailbox simulator, which emits the two
  // events seconds apart; ordinary mail hides it because a complaint usually
  // arrives hours after its delivery.
  //
  // This *narrows* the update rather than reordering it. Two actionable events
  // still resolve by timestamp, so the deliberate "an older bounce does not
  // beat a newer delivered" behaviour keeps its meaning, and a fresh send
  // resets `providerStatus` to null so a genuine re-send starts clean.
  const isSofterVerdict = !ACTIONABLE_PROVIDER_STATUSES.some(
    (actionable) => actionable === input.status,
  );

  // Run first and unconditionally, because it is the only row that answers a
  // question the others cannot: which *channel* this verdict belongs to. A
  // booking-scoped waiver email writes both a `notification_deliveries` row and
  // a `waiver_deliveries` one, and the branch below returns as soon as the
  // first of those updates — so folding this in there would mean a bounce on a
  // booking's waiver never reached the button that offered to send it.
  const [updatedChannel] = await db
    .update(waiverDeliveries)
    .set({
      providerStatus: input.status,
      providerStatusAt: input.occurredAt,
      detail: input.detail,
    })
    .where(
      and(
        eq(waiverDeliveries.providerMessageId, input.providerMessageId),
        ...(input.shopId ? [eq(waiverDeliveries.shopId, input.shopId)] : []),
        or(
          isNull(waiverDeliveries.providerStatusAt),
          lte(waiverDeliveries.providerStatusAt, input.occurredAt),
        ),
        isSofterVerdict
          ? or(
              isNull(waiverDeliveries.providerStatus),
              notInArray(waiverDeliveries.providerStatus, [...ACTIONABLE_PROVIDER_STATUSES]),
            )
          : undefined,
      ),
    )
    .returning({ id: waiverDeliveries.id });

  const [updated] = await db
    .update(notificationDeliveries)
    .set({
      providerStatus: input.status,
      providerStatusAt: input.occurredAt,
      providerDetail: input.detail,
    })
    .where(
      and(
        eq(notificationDeliveries.providerMessageId, input.providerMessageId),
        ...(input.shopId ? [eq(notificationDeliveries.shopId, input.shopId)] : []),
        or(
          isNull(notificationDeliveries.providerStatusAt),
          lte(notificationDeliveries.providerStatusAt, input.occurredAt),
        ),
        isSofterVerdict
          ? or(
              isNull(notificationDeliveries.providerStatus),
              notInArray(notificationDeliveries.providerStatus, [...ACTIONABLE_PROVIDER_STATUSES]),
            )
          : undefined,
      ),
    )
    .returning({ id: notificationDeliveries.id });
  if (updated || updatedChannel) return "applied";

  const [updatedIndependent] = await db
    .update(waiverRecords)
    .set({
      deliveryProviderStatus: input.status,
      deliveryProviderStatusAt: input.occurredAt,
      deliveryError: input.detail,
    })
    .where(
      and(
        eq(waiverRecords.deliveryProviderMessageId, input.providerMessageId),
        ...(input.shopId ? [eq(waiverRecords.shopId, input.shopId)] : []),
        or(
          isNull(waiverRecords.deliveryProviderStatusAt),
          lte(waiverRecords.deliveryProviderStatusAt, input.occurredAt),
        ),
        isSofterVerdict
          ? or(
              isNull(waiverRecords.deliveryProviderStatus),
              notInArray(waiverRecords.deliveryProviderStatus, [...ACTIONABLE_PROVIDER_STATUSES]),
            )
          : undefined,
      ),
    )
    .returning({ id: waiverRecords.id });
  if (updatedIndependent) return "applied";

  // The condition filtered zero rows either because no delivery row carries
  // this provider message id, or because one exists but already holds a
  // status at or after `occurredAt`. Only this empty-result path pays for
  // the extra lookup to tell those two apart.
  const [existing] = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.providerMessageId, input.providerMessageId))
    .limit(1);
  const [existingIndependent] = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.deliveryProviderMessageId, input.providerMessageId),
        ...(input.shopId ? [eq(waiverRecords.shopId, input.shopId)] : []),
      ),
    )
    .limit(1);
  const [existingChannel] = await db
    .select({ id: waiverDeliveries.id })
    .from(waiverDeliveries)
    .where(
      and(
        eq(waiverDeliveries.providerMessageId, input.providerMessageId),
        ...(input.shopId ? [eq(waiverDeliveries.shopId, input.shopId)] : []),
      ),
    )
    .limit(1);
  return existing || existingIndependent || existingChannel ? "stale" : "unknown_message";
}

/**
 * Open email issues for the staff dashboard; cancelled bookings need no
 * follow-up. An issue is either a send that never left (`failed`,
 * `not_configured`) or a send the provider later reported went nowhere —
 * a bounce or a spam complaint is invisible at send time and is the more
 * common real-world failure of the two.
 *
 * `window` bounds the result to trips departing in `[from, until]` — Today
 * only ever wants issues inside its own horizon, so the bound belongs in the
 * query, not a filter over every issue the shop has ever had.
 */
export async function listNotificationDeliveryIssues(
  db: AppDb,
  shopId: string,
  window: { from?: Date; until?: Date } = {},
) {
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
        window.from ? gte(trips.startsAt, window.from) : undefined,
        window.until ? lte(trips.startsAt, window.until) : undefined,
      ),
    )
    .groupBy(notificationDeliveries.id, bookings.id, people.id, trips.id)
    .orderBy(desc(notificationDeliveries.attemptedAt));
}

/**
 * Whether this booking's confirmation email *and* its waiver-link email both
 * actually left the building. A page may only promise mail it can see went out
 * — a walk-in party member with no address of their own, an unconfigured
 * provider, or a rejected recipient all leave the promise unearned
 * (design/principles.md #4). Returns a plain fact, not words.
 */
export async function bookingConfirmationAndWaiverEmailsSent(
  db: AppDb,
  shopId: string,
  bookingId: string,
): Promise<boolean> {
  const rows = await db
    .select({ kind: notificationDeliveries.kind })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.shopId, shopId),
        eq(notificationDeliveries.bookingId, bookingId),
        eq(notificationDeliveries.status, "sent"),
        inArray(notificationDeliveries.kind, ["booking_confirmation", "waiver_request"]),
      ),
    );
  const sent = new Set(rows.map((row) => row.kind));
  return sent.has("booking_confirmation") && sent.has("waiver_request");
}
