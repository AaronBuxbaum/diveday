import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import type { AppDb } from "./client";
import { type MessageSeat, messageSeats } from "./running-late";
import { bookings, trips } from "./schema";
import { liveTrip } from "./trips-live";

/** A seat an Inbox row names, and whether the late mark may be offered on it. */
export type InboxSeat = MessageSeat & {
  /** Inside the running-late window when they wrote (`messageSeats`). */
  lateWindow: boolean;
};

type Message = {
  id: string;
  personId: string | null;
  receivedAt: Date;
  /** Set on an "Ask to move" from the booking page (H-137): the seat it is about. */
  bookingId?: string | null;
};

/**
 * **The seats each Inbox message is about** (fourth UX review, item 32). Inside
 * the running-late window it is `messageSeats`' one answer, and the row may
 * offer "Mark running late". Outside it, every open seat the sender already
 * held when they wrote, soonest first: "Could I switch Saturday to next week?"
 * from a diver who also holds Wednesday is about one of the two, and only the
 * desk can tell which, so the row names both rather than guessing the soonest
 * (dive-domain review r4-4, F1). A seat booked after the message, a canceled
 * one and one whose boat has sailed are never named, and a stranger has none.
 * An Ask to move from the booking page names its own seat and nothing else.
 */
export async function inboxSeats(
  db: AppDb,
  shopId: string,
  messages: readonly Message[],
  now: Date,
): Promise<Map<string, InboxSeat[]>> {
  const found = new Map<string, InboxSeat[]>();
  // A message that names its booking (an Ask to move, H-137) is about that
  // seat alone, whenever it departs, and never offers the late mark; any other
  // answer here is the late-window seat.
  const late = await messageSeats(db, shopId, messages, now);
  for (const message of messages) {
    const seat = late.get(message.id);
    if (seat) found.set(message.id, [{ ...seat, lateWindow: !message.bookingId }]);
  }
  const rest = messages.filter(
    (message): message is Message & { personId: string } =>
      message.personId !== null && !message.bookingId && !found.has(message.id),
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
    const seats = held
      .filter((row) => row.personId === message.personId && row.bookedAt <= message.receivedAt)
      .map(({ bookingId, tripId, title, startsAt, runningLateAt }) => ({
        bookingId,
        tripId,
        title,
        startsAt,
        runningLateAt,
        lateWindow: false,
      }));
    if (seats.length > 0) found.set(message.id, seats);
  }
  return found;
}
