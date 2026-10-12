import { and, eq, inArray, isNull, lte, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import type { Notification, NotificationDelivery } from "@/lib/notifications";
import type { RehearsalIds } from "@/lib/rehearsal-export";
import { isUuid } from "@/lib/uuid";
import type { AppDb, DbExecutor } from "./client";
import {
  bookingCheckouts,
  bookings,
  tripInvitations,
  trips,
  tripWaitlistEntries,
  waiverRecords,
} from "./schema";

/**
 * **Rehearsal departures** (ADR 20261012-rehearsal-departures; glossary
 * "Rehearsal").
 *
 * A rehearsal is a departure a shop runs for training day: staff seat test
 * divers, check them in, call the roll, close it out. Nothing about it leaves
 * the shop. The flag is `trips.is_rehearsal`; this module holds the pieces of
 * honouring it that are more than a `notRehearsal()` in a query:
 *
 * - {@link notificationHeldForRehearsal}, the check every outbound email path
 *   in `src/db/notifications.ts` asks before a provider is called;
 * - {@link isRehearsalTrip}, the check the push and crew paths ask;
 * - {@link clearFinishedRehearsals}, the nightly delete;
 * - {@link shopRehearsalIds}, what the export leaves out.
 *
 * The full list of places that honour the flag is the ADR's, and
 * `src/db/rehearsal-coverage.test.ts` walks it.
 */

/**
 * What a send held back for a rehearsal reports. Non-retryable, so it is never
 * queued, and coded, so a delivery row reads "rehearsal" rather than an error
 * someone should chase. The same shape the provider gives a reserved test
 * address (`reservedTestRecipientDelivery`).
 */
export const REHEARSAL_HELD_DELIVERY = {
  status: "failed",
  retryable: false,
  errorCode: "rehearsal_departure",
} as const satisfies NotificationDelivery;

/** Whether this departure, in this shop, is a rehearsal. Deleted rows included. */
export async function isRehearsalTrip(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<boolean> {
  if (!isUuid(tripId)) return false;
  const [row] = await db
    .select({ isRehearsal: trips.isRehearsal })
    .from(trips)
    // diveday:allow-deleted-trips: a cleared rehearsal is still a rehearsal,
    // and a late send about one must still be held.
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
    .limit(1);
  return row?.isRehearsal === true;
}

/** The handles a notification carries that lead back to a departure. */
type TripHandles = {
  tripId?: string;
  bookingId?: string;
  waitlistEntryId?: string;
  invitationId?: string;
  checkoutId?: string;
  waiverRecordId?: string;
};

function tripHandlesOf(notification: Notification): TripHandles {
  const handles: TripHandles = {};
  const fields = notification as Record<string, unknown>;
  for (const key of [
    "tripId",
    "bookingId",
    "waitlistEntryId",
    "invitationId",
    "checkoutId",
    "waiverRecordId",
  ] as const) {
    const value = fields[key];
    if (typeof value === "string" && isUuid(value)) handles[key] = value;
  }
  return handles;
}

/**
 * **Is this message about a rehearsal?** Asked of every outbound email before
 * a provider sees it (`sendNotification`, `sendNotificationBatch`, the retry
 * drain).
 *
 * Every kind that is about a departure carries one handle back to it — the
 * departure itself, a seat, a wait-list entry, an invitation, a checkout or a
 * signed release —
 * and each is resolved inside the notification's own shop. A kind that carries
 * none of them is not held here: crew changes are dropped where they are
 * recorded (`src/db/crew-notices.ts`), a last-minute deal is refused where it
 * is composed (`src/db/trip-promos.ts`), and the rest (account mail, the
 * Monday digest, gear) are not about a departure at all.
 */
export async function notificationHeldForRehearsal(
  db: DbExecutor,
  notification: Notification,
): Promise<boolean> {
  if (!("shopId" in notification) || typeof notification.shopId !== "string") return false;
  const shopId = notification.shopId;
  const handles = tripHandlesOf(notification);
  const tripIds = new Set<string>();
  if (handles.tripId) tripIds.add(handles.tripId);
  if (handles.bookingId) {
    const [row] = await db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(and(eq(bookings.id, handles.bookingId), eq(bookings.shopId, shopId)))
      .limit(1);
    if (row) tripIds.add(row.tripId);
  }
  if (handles.waitlistEntryId) {
    const [row] = await db
      .select({ tripId: tripWaitlistEntries.tripId })
      .from(tripWaitlistEntries)
      .where(
        and(
          eq(tripWaitlistEntries.id, handles.waitlistEntryId),
          eq(tripWaitlistEntries.shopId, shopId),
        ),
      )
      .limit(1);
    if (row) tripIds.add(row.tripId);
  }
  if (handles.invitationId) {
    const [row] = await db
      .select({ tripId: tripInvitations.tripId })
      .from(tripInvitations)
      .where(and(eq(tripInvitations.id, handles.invitationId), eq(tripInvitations.shopId, shopId)))
      .limit(1);
    if (row) tripIds.add(row.tripId);
  }
  if (handles.checkoutId) {
    const [row] = await db
      .select({ tripId: bookingCheckouts.tripId })
      .from(bookingCheckouts)
      .where(and(eq(bookingCheckouts.id, handles.checkoutId), eq(bookingCheckouts.shopId, shopId)))
      .limit(1);
    if (row) tripIds.add(row.tripId);
  }
  if (handles.waiverRecordId) {
    // A guardian's copy of a release signed for a seat on a rehearsal.
    const [row] = await db
      .select({ tripId: bookings.tripId })
      .from(waiverRecords)
      .innerJoin(bookings, eq(bookings.id, waiverRecords.bookingId))
      .where(and(eq(waiverRecords.id, handles.waiverRecordId), eq(waiverRecords.shopId, shopId)))
      .limit(1);
    if (row) tripIds.add(row.tripId);
  }
  if (tripIds.size === 0) return false;
  const [rehearsal] = await db
    .select({ id: trips.id })
    .from(trips)
    // diveday:allow-deleted-trips: held whether or not the rehearsal is cleared.
    .where(
      and(eq(trips.shopId, shopId), inArray(trips.id, [...tripIds]), eq(trips.isRehearsal, true)),
    )
    .limit(1);
  if (!rehearsal) return false;
  // Codes and ids only: the payload carries an address.
  log("notification.held_for_rehearsal", "info", { shopId, kind: notification.kind });
  return true;
}

/**
 * **The nightly delete** (ADR 20261012-rehearsal-departures): every rehearsal
 * that has come home is taken off the board, and its seats are cancelled.
 *
 * Soft, like every delete (ADR 20260820-every-delete-is-soft): the departure
 * keeps its rows and gains `deleted_at`. The seats are cancelled by a direct
 * status write rather than through the cancellation path, because that path
 * tells the diver, and a rehearsal tells nobody anything. Returns how many
 * departures it cleared.
 *
 * Across every shop: it runs from the nightly trip-series cron
 * (`src/app/api/cron/trip-series/`), which has no shop and logs the count.
 */
export async function clearFinishedRehearsals(db: AppDb, now: Date = nowDate()): Promise<number> {
  return db.transaction(async (tx) => {
    const cleared = await tx
      .update(trips)
      .set({ deletedAt: now })
      .where(and(eq(trips.isRehearsal, true), isNull(trips.deletedAt), lte(trips.endsAt, now)))
      .returning({ id: trips.id, shopId: trips.shopId });
    if (cleared.length === 0) return 0;
    await tx
      .update(bookings)
      .set({ status: "cancelled" })
      .where(
        and(
          inArray(
            bookings.tripId,
            cleared.map((trip) => trip.id),
          ),
          ne(bookings.status, "cancelled"),
        ),
      );
    return cleared.length;
  });
}

/**
 * Every rehearsal this shop has held, and every seat on one, cleared or not:
 * what the export leaves out (`withoutRehearsals`, `src/lib/rehearsal-export.ts`).
 */
export async function shopRehearsalIds(db: DbExecutor, shopId: string): Promise<RehearsalIds> {
  const rows = await db
    .select({ tripId: trips.id, bookingId: bookings.id })
    .from(trips)
    // diveday:allow-deleted-trips: a cleared rehearsal is left out of the
    // export as surely as a live one.
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), eq(bookings.shopId, shopId)))
    .where(and(eq(trips.shopId, shopId), eq(trips.isRehearsal, true)));
  return {
    tripIds: new Set(rows.map((row) => row.tripId)),
    bookingIds: new Set(rows.flatMap((row) => (row.bookingId ? [row.bookingId] : []))),
  };
}
