import { and, eq, inArray, isNull } from "drizzle-orm";
import { openOrdersForBookings } from "@/db/orders";
import { listTodayHelpWork, type TodayHelpRequest } from "@/features/messages/help-requests";
import { nowDate } from "@/lib/clock";
import { nextReminderAt, TRIP_REMINDER_CADENCES } from "@/lib/reminders";
import type { AppDb } from "../../../db/client";
import { notificationDeliveries } from "../../../db/schema/index";

/** A booking's open order: what a pay link or a resent invoice is made from. */
export type OpenOrderFact = { id: string; hostedInvoiceUrl: string | null };

/**
 * What the trip page's fix list reads beyond the roster, one read each and all
 * keyed by booking: the open help request, the open invoice, and the reminders
 * already sent. Nothing here decides who can board.
 */
export async function fixListFacts(
  db: AppDb,
  shopId: string,
  tripId: string,
  startsAt: Date,
  bookingIds: readonly string[],
  owingBookingIds: readonly string[],
): Promise<{
  helpRequestByBooking: ReadonlyMap<string, TodayHelpRequest>;
  openOrderByBooking: ReadonlyMap<string, OpenOrderFact>;
  /** When each seat's next reminder goes out; a seat with none left is absent. */
  nextReminderAtByBooking: ReadonlyMap<string, Date>;
}> {
  if (bookingIds.length === 0) {
    return {
      helpRequestByBooking: new Map(),
      openOrderByBooking: new Map(),
      nextReminderAtByBooking: new Map(),
    };
  }
  const [help, orders, delivered] = await Promise.all([
    listTodayHelpWork(db, shopId, [tripId]),
    // Only a seat that owes money can have an invoice to send.
    openOrdersForBookings(db, shopId, [...owingBookingIds]),
    // With no reminder left ahead, nothing sent can change what the page says.
    nextReminderAt({ startsAt, now: nowDate(), sentKinds: new Set() }) === null
      ? []
      : db
          .select({
            bookingId: notificationDeliveries.bookingId,
            kind: notificationDeliveries.kind,
          })
          .from(notificationDeliveries)
          .where(
            and(
              inArray(notificationDeliveries.bookingId, [...bookingIds]),
              inArray(
                notificationDeliveries.kind,
                TRIP_REMINDER_CADENCES.map((cadence) => cadence.kind),
              ),
              eq(notificationDeliveries.status, "sent"),
              isNull(notificationDeliveries.supersededAt),
            ),
          ),
  ]);
  const remindersSentByBooking = new Map<string, Set<string>>();
  for (const row of delivered) {
    const kinds = remindersSentByBooking.get(row.bookingId) ?? new Set<string>();
    kinds.add(row.kind);
    remindersSentByBooking.set(row.bookingId, kinds);
  }
  return {
    helpRequestByBooking: new Map(help.open.map((request) => [request.bookingId, request])),
    openOrderByBooking: new Map(
      [...orders].map(([bookingId, order]) => [
        bookingId,
        { id: order.id, hostedInvoiceUrl: order.hostedInvoiceUrl ?? null },
      ]),
    ),
    nextReminderAtByBooking: nextRemindersOf(bookingIds, startsAt, remindersSentByBooking),
  };
}

function nextRemindersOf(
  bookingIds: readonly string[],
  startsAt: Date,
  sent: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, Date> {
  const now = nowDate();
  const next = new Map<string, Date>();
  for (const bookingId of bookingIds) {
    const at = nextReminderAt({ startsAt, now, sentKinds: sent.get(bookingId) ?? new Set() });
    if (at) next.set(bookingId, at);
  }
  return next;
}
