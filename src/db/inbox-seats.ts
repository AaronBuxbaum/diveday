import { and, asc, count, eq, gt, inArray, ne } from "drizzle-orm";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import type { AppDb } from "./client";
import { type MessageSeat, messageSeats } from "./running-late";
import { bookings, buddyPairMembers, trips } from "./schema";
import { liveTrip } from "./trips-live";

/** A seat an Inbox row names, and whether the late mark may be offered on it. */
export type InboxSeat = MessageSeat & {
  /** Inside the running-late window when they wrote (`messageSeats`). */
  lateWindow: boolean;
  /**
   * On an Ask to move (H-20261014-ask-to-move), why the roster's Move will refuse this seat as
   * it stands (issue #2668): it leads a party (`moveBooking`'s `leads_party`,
   * with the party's live seats), or it sits on a buddy team (`on_buddy_team`).
   * Read off the booking when the Inbox lists it; absent otherwise.
   */
  moveRefusal?: { kind: "leads_party"; partySize: number } | { kind: "on_buddy_team" };
};

type Message = {
  id: string;
  personId: string | null;
  receivedAt: Date;
  /** Set on an "Ask to move" from the booking page (H-20261014-ask-to-move): the seat it is about. */
  bookingId?: string | null;
};

/**
 * **The seats each Inbox message is about** (fourth UX review, item 32). Inside
 * the running-late window it is `messageSeats`' answer (every late-window
 * seat), and the row may offer "Mark running late" on each. Outside it, every open seat the sender already
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
  // A message that names its booking (an Ask to move, H-20261014-ask-to-move) is about that
  // seat alone, whenever it departs, and never offers the late mark; any other
  // answer here is the late-window seat.
  const late = await messageSeats(db, shopId, messages, now);
  const asked = [...late.entries()].flatMap(([messageId, seats]) =>
    messages.some((message) => message.id === messageId && message.bookingId) ? seats : [],
  );
  const refusals = await moveRefusals(db, shopId, asked);
  for (const message of messages) {
    const seats = late.get(message.id);
    if (seats) {
      found.set(
        message.id,
        seats.map((seat) => {
          const moveRefusal = message.bookingId ? refusals.get(seat.bookingId) : undefined;
          return {
            ...seat,
            lateWindow: !message.bookingId,
            ...(moveRefusal ? { moveRefusal } : {}),
          };
        }),
      );
    }
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

/**
 * The two refusals `moveBooking` makes before anything else about a seat
 * (issue #2668), read for the seats Asks to move name: a party lead with live
 * seats behind it, and a seat on a buddy team on its departure. The same
 * predicates `moveBooking` asks, so the row and the roster cannot disagree.
 */
async function moveRefusals(
  db: AppDb,
  shopId: string,
  seats: readonly MessageSeat[],
): Promise<Map<string, NonNullable<InboxSeat["moveRefusal"]>>> {
  const found = new Map<string, NonNullable<InboxSeat["moveRefusal"]>>();
  if (seats.length === 0) return found;
  const bookingIds = [...new Set(seats.map((seat) => seat.bookingId))];
  const [followers, teamed] = await Promise.all([
    db
      .select({ leadId: bookings.partyLeadBookingId, seats: count() })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, shopId),
          inArray(bookings.partyLeadBookingId, bookingIds),
          ne(bookings.status, "cancelled"),
        ),
      )
      .groupBy(bookings.partyLeadBookingId),
    db
      .select({ bookingId: buddyPairMembers.bookingId, tripId: buddyPairMembers.tripId })
      .from(buddyPairMembers)
      .where(
        and(eq(buddyPairMembers.shopId, shopId), inArray(buddyPairMembers.bookingId, bookingIds)),
      ),
  ]);
  for (const seat of seats) {
    if (teamed.some((row) => row.bookingId === seat.bookingId && row.tripId === seat.tripId)) {
      found.set(seat.bookingId, { kind: "on_buddy_team" });
    }
  }
  // The party is said first, as `moveBooking` refuses it first.
  for (const row of followers) {
    if (row.leadId && row.seats > 0) {
      found.set(row.leadId, { kind: "leads_party", partySize: row.seats + 1 });
    }
  }
  return found;
}
