import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import type { AppDb } from "./client";
import { type MessageSeat, messageSeats } from "./running-late";
import { bookings, trips } from "./schema";
import { liveTrip } from "./trips-live";

/** The seat an Inbox row names, and whether the late mark may be offered on it. */
export type InboxSeat = MessageSeat & {
  /** Inside the running-late window when they wrote (`messageSeats`). */
  lateWindow: boolean;
};

type Message = { id: string; personId: string | null; receivedAt: Date };

/**
 * **The seat each Inbox message is about** (fourth UX review, item 32). Inside
 * the running-late window it is `messageSeats`' answer, and the row may offer
 * "Mark running late". Outside it, the sender's soonest open seat that they
 * already held when they wrote: "Could I switch to the afternoon boat?" sent
 * three days out is about a seat, and naming it is what lets the desk open it
 * and move it. A seat booked after the message, a canceled one and one whose
 * boat has sailed are never named, and a stranger has none.
 */
export async function inboxSeats(
  db: AppDb,
  shopId: string,
  messages: readonly Message[],
  now: Date,
): Promise<Map<string, InboxSeat>> {
  const found = new Map<string, InboxSeat>();
  const late = await messageSeats(db, shopId, messages, now);
  for (const [id, seat] of late) found.set(id, { ...seat, lateWindow: true });
  const rest = messages.filter(
    (message): message is Message & { personId: string } =>
      message.personId !== null && !found.has(message.id),
  );
  if (rest.length === 0) return found;
  const held = await db
    .select({
      personId: bookings.personId,
      bookedAt: bookings.createdAt,
      bookingId: bookings.id,
      runningLateAt: bookings.runningLateAt,
      tripId: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(trips.shopId, shopId),
        inArray(bookings.personId, [...new Set(rest.map((message) => message.personId))]),
        eq(bookings.status, "booked"),
        eq(trips.status, "scheduled"),
        liveTrip(),
        // Not yet sailed: the scheduled time plus the one departure buffer.
        gt(trips.startsAt, new Date(now.getTime() - DEPARTURE_BUFFER_MS)),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(bookings.id));
  for (const message of rest) {
    const seat = held.find(
      (row) => row.personId === message.personId && row.bookedAt <= message.receivedAt,
    );
    if (!seat) continue;
    const { bookingId, tripId, title, startsAt, runningLateAt } = seat;
    found.set(message.id, { bookingId, tripId, title, startsAt, runningLateAt, lateWindow: false });
  }
  return found;
}
