import { and, eq, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { DAY_MS, nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import type { Notification, NotificationDelivery } from "@/lib/notifications";
import { REHEARSAL_KEPT_DAYS, rehearsalMayClear } from "@/lib/rehearsal-clearing";
import type { RehearsalIds } from "@/lib/rehearsal-export";
import { isUuid } from "@/lib/uuid";
import { releasePackageCoverageForBooking } from "./bookings";
import type { AppDb, DbExecutor } from "./client";
import { releaseUnclaimedGearReservationsForTrips } from "./gear-reservations";
import {
  bookingCheckouts,
  bookings,
  executedDives,
  incidentReports,
  interests,
  rollCallCrewEvents,
  rollCallEvents,
  shops,
  trips,
  waiverRecords,
} from "./schema";
import { liveTrip } from "./trips-live";

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
  interestId?: string;
  checkoutId?: string;
  waiverRecordId?: string;
};

function tripHandlesOf(notification: Notification): TripHandles {
  const handles: TripHandles = {};
  const fields = notification as Record<string, unknown>;
  for (const key of [
    "tripId",
    "bookingId",
    "interestId",
    "checkoutId",
    "waiverRecordId",
  ] as const) {
    const value = fields[key];
    if (typeof value === "string" && isUuid(value)) handles[key] = value;
  }
  // Fly-safe corrections name their booking as `seatId`; resolve it through
  // the same tenant-scoped booking path as every other booking-bound notice.
  const seatId = fields.seatId;
  if (typeof seatId === "string" && isUuid(seatId)) handles.bookingId = seatId;
  return handles;
}

/**
 * **Is this message about a rehearsal?** Asked of every outbound email before
 * a provider sees it (`sendNotification`, `sendNotificationBatch`, the retry
 * drain).
 *
 * Every kind that is about a departure carries one handle back to it — the
 * departure itself, a seat, an interest, a checkout or a
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
  if (handles.interestId) {
    const [row] = await db
      .select({ tripId: interests.tripId })
      .from(interests)
      .where(and(eq(interests.id, handles.interestId), eq(interests.shopId, shopId)))
      .limit(1);
    if (row?.tripId) tripIds.add(row.tripId);
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
 * **The nightly delete** (ADR 20261012-rehearsal-departures): a rehearsal is
 * taken off the board, and its seats cancelled, once `rehearsalMayClear`
 * says so — a full night in the shop's zone since it was due home, and the
 * fly-safe look-back run out, so no later boat still counts its divers' day.
 *
 * **A rehearsal with real evidence is never cleared here** (see
 * {@link rehearsalsWithEvidence}): a diver or crew boarding, an after-dive
 * count, a logged dive or an incident report is a record of people in the
 * water, and only an owner deletes that.
 * The trip page says so on its banner.
 *
 * Soft, like every delete (ADR 20260820-every-delete-is-soft): the departure
 * keeps its rows and gains `deleted_at`. The seats are cancelled by a direct
 * status write rather than through the cancellation path, because that path
 * tells the diver and a rehearsal tells nobody anything; what the path would
 * give back — prepaid dives and unclaimed gear — is given back here. Returns
 * how many departures it cleared.
 *
 * Across every shop: it runs from the nightly trip-series cron
 * (`src/app/api/cron/trip-series/`), which has no shop and logs the count.
 */
export async function clearFinishedRehearsals(db: AppDb, now: Date = nowDate()): Promise<number> {
  const horizon = new Date(now.getTime() - REHEARSAL_KEPT_DAYS * DAY_MS);
  const candidates = await db
    .select({ id: trips.id, shopId: trips.shopId, endsAt: trips.endsAt, zone: shops.timezone })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(and(eq(trips.isRehearsal, true), liveTrip(), lte(trips.endsAt, horizon)));
  const due = candidates.filter((trip) => rehearsalMayClear(trip.endsAt, now, trip.zone));
  let cleared = 0;
  let keptCount = 0;
  // One shop at a time: the evidence is read inside the shop that owns it, on
  // the event tables' `shop_id`-led indexes.
  for (const shopId of new Set(due.map((trip) => trip.shopId))) {
    const shopDue = due.filter((trip) => trip.shopId === shopId).map((trip) => trip.id);
    const kept = await rehearsalsWithEvidence(db, shopId, shopDue);
    keptCount += kept.size;
    const tripIds = shopDue.filter((id) => !kept.has(id));
    if (tripIds.length === 0) continue;
    await db.transaction((tx) => clearShopRehearsals(tx, shopId, tripIds, now));
    cleared += tripIds.length;
  }
  if (keptCount > 0) log("rehearsal.kept_with_evidence", "info", { count: keptCount });
  return cleared;
}

async function clearShopRehearsals(
  tx: DbExecutor,
  shopId: string,
  tripIds: string[],
  now: Date,
): Promise<void> {
  await tx
    .update(trips)
    .set({ deletedAt: now })
    .where(and(eq(trips.shopId, shopId), inArray(trips.id, tripIds), isNull(trips.deletedAt)));
  // Unclaimed units first, while the seats still read as the trip's.
  await releaseUnclaimedGearReservationsForTrips(tx, { shopId, tripIds });
  const seats = await tx
    .update(bookings)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.tripId, tripIds),
        ne(bookings.status, "cancelled"),
      ),
    )
    .returning({ id: bookings.id });
  // A rehearsal seat spends no prepaid dive (`settlePackageCoverage`); this
  // gives back any one spent before that rule, or by a path that missed it.
  for (const seat of seats) await releasePackageCoverageForBooking(tx, shopId, seat.id);
}

/**
 * The rehearsals among this shop's `tripIds` that carry real evidence: a
 * diver or crew boarding at the dock, any after-dive count of either, a
 * logged dive, or an incident report, draft or filed. Only rows stamped with
 * this shop count, and every read leads with `shop_id` like its index.
 *
 * Two policies, stated side by side so neither is "fixed" to match the other:
 * - **This sweep** treats a dockside `not_boarded` as clerical. A drill where
 *   nobody left the dock has nothing an investigator would ask for, so the
 *   nightly delete may clear it.
 * - **The staff delete door** (`countRollCallEvidence` in `trips-schedule.ts`)
 *   refuses on *any* roll-call row, dockside ones included: a person pressing
 *   Delete on a departure someone has started calling is told no, and the
 *   automatic sweep is the only thing that clears a clerical-only rehearsal.
 */
export async function rehearsalsWithEvidence(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<Set<string>> {
  if (tripIds.length === 0) return new Set();
  const counted = await db
    .selectDistinct({ tripId: rollCallEvents.tripId })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        inArray(rollCallEvents.tripId, [...tripIds]),
        or(eq(rollCallEvents.status, "boarded"), ne(rollCallEvents.checkpoint, "departure")),
      ),
    );
  const crew = await db
    .selectDistinct({ tripId: rollCallCrewEvents.tripId })
    .from(rollCallCrewEvents)
    .where(
      and(
        eq(rollCallCrewEvents.shopId, shopId),
        inArray(rollCallCrewEvents.tripId, [...tripIds]),
        or(
          eq(rollCallCrewEvents.status, "boarded"),
          ne(rollCallCrewEvents.checkpoint, "departure"),
        ),
      ),
    );
  const reported = await db
    .selectDistinct({ tripId: incidentReports.tripId })
    .from(incidentReports)
    .where(
      and(
        eq(incidentReports.shopId, shopId),
        inArray(incidentReports.tripId, [...tripIds]),
        // A discarded draft is not evidence of anything.
        isNull(incidentReports.deletedAt),
      ),
    );
  const logged = await db
    .selectDistinct({ tripId: executedDives.tripId })
    .from(executedDives)
    .where(
      and(
        eq(executedDives.shopId, shopId),
        inArray(executedDives.tripId, [...tripIds]),
        isNull(executedDives.deletedAt),
      ),
    );
  return new Set([...counted, ...crew, ...reported, ...logged].map((row) => row.tripId));
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
