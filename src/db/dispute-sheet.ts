import { and, desc, eq, inArray, isNotNull, lte, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { nowDate } from "@/lib/clock";
import {
  assembleDisputeSheet,
  DISPUTE_ACTIVITY_CODES,
  type DisputeSheet,
} from "@/lib/dispute-sheet";
import { isUuid } from "@/lib/uuid";
import type { AppDb, DbExecutor } from "./client";
import { recordDiverActivity } from "./operations";
import { queryAll } from "./query-helpers";
import {
  activityEvents,
  bookingArrivalEvents,
  bookings,
  orderLineItems,
  orders,
  people,
  rollCallEvents,
  trips,
  waiverRecords,
} from "./schema";

/**
 * **The reader behind a seat's dispute sheet** (issue #2390).
 *
 * Every select here names its columns. That is the privacy control, not a
 * style choice: the sheet leaves the shop, and `waiver_records` holds the
 * diver's medical answers, a physician's name and the referral state a
 * `select()` would hand back whole. The waiver read below asks for six columns
 * and none of them is a medical field, so the answers never enter this
 * process's sheet path at all. `assembleDisputeSheet` (src/lib/dispute-sheet.ts)
 * is the second wall and the one that decides what may print.
 *
 * Gate and tenancy are the caller's and this reader's, in that order: the page
 * checks `canPersonExportDisputeSheet` through `requireShopSurface`; every
 * table touched here carries `shopId` in its predicate, so an order id from
 * another shop selects nothing and the answer is null.
 *
 * Null means "no sheet": an unknown order, another shop's order, or an order
 * raised for no seat (a gear sale, a package) — there is nobody to have turned
 * up.
 */
export async function getDisputeSheet(
  db: DbExecutor,
  shopId: string,
  orderId: string,
  shopName: string,
  timezone: string,
  generatedAt: Date = nowDate(),
): Promise<DisputeSheet | null> {
  if (!isUuid(shopId) || !isUuid(orderId)) return null;

  const [order] = await db
    .select({
      description: orders.description,
      status: orders.status,
      currency: orders.currency,
      totalCents: orders.totalCents,
      taxCents: orders.taxCents,
      amountPaidCents: orders.amountPaidCents,
      refundedCents: orders.refundedCents,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      bookingId: orders.bookingId,
    })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)))
    .limit(1);
  if (!order?.bookingId) return null;
  const bookingId = order.bookingId;

  const [seat] = await db
    .select({
      tripId: bookings.tripId,
      personId: bookings.personId,
      fullName: people.fullName,
      heldAt: bookings.identityUnconfirmedAt,
      bookedAs: bookings.identityBookedAs,
      tripTitle: trips.title,
      startsAt: trips.startsAt,
      plannedDives: trips.plannedDives,
    })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
    // diveday:allow-deleted-trips: a dispute is about a departure that happened, deleted since or not.
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  if (!seat) return null;

  const recorders = alias(people, "recorders");
  const identityHeld = seat.heldAt !== null;

  const [lines, waivers, arrivals, rollCalls, activity] = await queryAll(db, [
    () =>
      db
        .select({
          description: orderLineItems.description,
          kind: orderLineItems.kind,
          quantity: orderLineItems.quantity,
          unitAmountCents: orderLineItems.unitAmountCents,
        })
        .from(orderLineItems)
        .where(and(eq(orderLineItems.orderId, orderId), eq(orderLineItems.shopId, shopId)))
        .orderBy(orderLineItems.createdAt),
    // The diver's newest signature at or before the departure. A diver signs
    // once per shop (`effectiveWaiverForBooking`), so this is person-scoped,
    // not booking-scoped; one signed after the boat left proves nothing about
    // the morning and is not shown. `medical_review` is a signed record too,
    // and the status itself is never selected: that a diver was referred is
    // medical information the sheet does not carry.
    () =>
      identityHeld
        ? Promise.resolve([])
        : db
            .select({
              signedAt: waiverRecords.signedAt,
              signedName: waiverRecords.signedName,
              signatureMethod: waiverRecords.signatureMethod,
              templateTitle: waiverRecords.templateTitle,
              templateVersion: waiverRecords.templateVersion,
            })
            .from(waiverRecords)
            .where(
              and(
                eq(waiverRecords.shopId, shopId),
                eq(waiverRecords.personId, seat.personId),
                inArray(waiverRecords.status, ["completed", "medical_review"]),
                isNotNull(waiverRecords.signedAt),
                lte(waiverRecords.signedAt, seat.startsAt),
              ),
            )
            .orderBy(desc(waiverRecords.signedAt))
            .limit(1),
    () =>
      db
        .select({
          status: bookingArrivalEvents.status,
          occurredAt: bookingArrivalEvents.occurredAt,
          createdAt: bookingArrivalEvents.createdAt,
          seq: bookingArrivalEvents.seq,
          source: bookingArrivalEvents.source,
          recordedByName: recorders.fullName,
        })
        .from(bookingArrivalEvents)
        // diveday:allow-deleted-people: who recorded it, removed since or not.
        .innerJoin(
          recorders,
          and(
            eq(recorders.id, bookingArrivalEvents.recordedByPersonId),
            eq(recorders.shopId, shopId),
          ),
        )
        .where(
          and(
            eq(bookingArrivalEvents.shopId, shopId),
            eq(bookingArrivalEvents.bookingId, bookingId),
          ),
        ),
    // No `note`: a crew member's sentence about a missing diver is theirs, not
    // evidence the shop hands a card network.
    () =>
      db
        .select({
          checkpoint: rollCallEvents.checkpoint,
          status: rollCallEvents.status,
          occurredAt: rollCallEvents.occurredAt,
          createdAt: rollCallEvents.createdAt,
          seq: rollCallEvents.seq,
          source: rollCallEvents.source,
          recordedByName: recorders.fullName,
        })
        .from(rollCallEvents)
        // diveday:allow-deleted-people: who recorded it, removed since or not.
        .innerJoin(
          recorders,
          and(eq(recorders.id, rollCallEvents.recordedByPersonId), eq(recorders.shopId, shopId)),
        )
        .where(and(eq(rollCallEvents.shopId, shopId), eq(rollCallEvents.bookingId, bookingId))),
    () =>
      db
        .select({
          code: activityEvents.code,
          params: activityEvents.params,
          occurredAt: activityEvents.occurredAt,
          seq: activityEvents.seq,
        })
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.shopId, shopId),
            inArray(activityEvents.code, [...DISPUTE_ACTIVITY_CODES]),
            or(
              // The writers that name the seat: check-in, no-show, the money acts.
              eq(activityEvents.bookingId, bookingId),
              // The diver's own cancel from their trip link is written on the
              // departure with the diver as its actor. A held seat's matched
              // person is not known to be who booked, so it claims none.
              identityHeld
                ? undefined
                : and(
                    eq(activityEvents.tripId, seat.tripId),
                    eq(activityEvents.actorPersonId, seat.personId),
                    inArray(activityEvents.code, ["seat_self_cancelled", "seat_self_refunded"]),
                  ),
            ),
          ),
        ),
  ]);

  return assembleDisputeSheet({
    shopName,
    timezone,
    generatedAt,
    diverName: identityHeld ? seat.bookedAs?.trim() || seat.fullName : seat.fullName,
    identityHeld,
    trip: { title: seat.tripTitle, startsAt: seat.startsAt, plannedDives: seat.plannedDives },
    order: { ...order, description: order.description ?? "", lines },
    waiver: waivers[0] ?? null,
    arrivalEvents: arrivals,
    rollCallEvents: rollCalls,
    activity,
  });
}

/**
 * **Opening the sheet is on the diver's trail**, beside the record export that
 * also hands a diver's data to someone outside the shop (issue #2390). The line
 * lands on the booked person's record; a held seat writes none, because the
 * record it would land on is the matched person's, who may not be who booked.
 * Best effort and never throws: the sheet is already on screen.
 */
export async function recordDisputeSheetOpened(
  db: AppDb,
  shopId: string,
  orderId: string,
  actorPersonId: string,
): Promise<boolean> {
  if (!isUuid(shopId) || !isUuid(orderId)) return false;
  const [seat] = await db
    .select({ personId: bookings.personId, heldAt: bookings.identityUnconfirmedAt })
    .from(orders)
    .innerJoin(bookings, and(eq(bookings.id, orders.bookingId), eq(bookings.shopId, shopId)))
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)))
    .limit(1);
  if (!seat || seat.heldAt) return false;
  return recordDiverActivity(db, {
    shopId,
    personId: seat.personId,
    actorPersonId,
    code: "dispute_sheet_printed",
  });
}
