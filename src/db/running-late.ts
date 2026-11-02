import { and, asc, eq, gt, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { canSayRunningLate, RUNNING_LATE_LEAD_MS } from "@/lib/running-late";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import type { AppDb, DbExecutor } from "./client";
import { recordDeskEvent } from "./desk-events";
import { recordDiverActivity } from "./operations";
import { bookings, people, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **"Running late", written** (J3). Three doors reach this module — the
 * diver's own `/ready` link, a `LATE` reply on the shop's WhatsApp or email
 * (`src/db/reply-keywords.ts`), and a `LATE` text to DiveDay's number
 * (`/api/webhooks/sms`) — and all of them end in one guarded update:
 *
 * - **Only an open seat.** `canSayRunningLate` (src/lib/running-late.ts):
 *   booked, not checked in, on a scheduled departure that leaves within the
 *   next day and has not sailed (`hasSailed`). Re-checked in the `where` clause, so a
 *   check-in landing between the read and the write wins.
 * - **The first statement stands.** A second tap, or a provider redelivering
 *   the same reply, changes nothing: "said 7:42" stays the moment the diver
 *   first said it. Only the diver's own link takes it back
 *   (`clearBookingRunningLate`), while the seat could still say it.
 *
 * It gates nothing (see `src/lib/running-late.ts`), which is why a reply
 * channel authenticated by an address alone may write it.
 */

export type RunningLateOutcome =
  | { status: "marked"; bookingId: string; at: Date }
  /** Said before; the stored instant is the one returned. */
  | { status: "already"; bookingId: string; at: Date }
  /** No seat this could be about: checked in, released, the boat gone, or too far off. */
  | { status: "closed" };

/**
 * The one write. Guarded by the same rule the read applied. `saidAt` is the
 * instant stored, when the diver said it somewhere other than this request (a
 * message a staffer marks later); the window is always checked at `now`.
 */
async function stamp(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
  now: Date,
  saidAt: Date = now,
  actorPersonId?: string,
): Promise<RunningLateOutcome> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        status: bookings.status,
        runningLateAt: bookings.runningLateAt,
        tripStatus: trips.status,
        startsAt: trips.startsAt,
      })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(
          eq(bookings.shopId, shopId),
          eq(trips.shopId, shopId),
          eq(bookings.id, bookingId),
          liveTrip(),
        ),
      )
      .limit(1);
    if (!row) return { status: "closed" };
    if (
      !canSayRunningLate({
        bookingStatus: row.status,
        tripStatus: row.tripStatus,
        startsAt: row.startsAt,
        now,
      })
    ) {
      return { status: "closed" };
    }
    if (row.runningLateAt) return { status: "already", bookingId, at: row.runningLateAt };
    const [updated] = await tx
      .update(bookings)
      .set({ runningLateAt: saidAt })
      .where(
        and(
          eq(bookings.shopId, shopId),
          eq(bookings.id, bookingId),
          eq(bookings.status, "booked"),
          isNull(bookings.runningLateAt),
        ),
      )
      .returning({
        at: bookings.runningLateAt,
        tripId: bookings.tripId,
        personId: bookings.personId,
      });
    if (updated?.at) {
      await recordDeskEvent(tx, {
        shopId,
        tripId: updated.tripId,
        bookingId,
        subjectPersonId: updated.personId,
        actorPersonId,
        kind: "running_late",
        occurredAt: now,
      });
      return { status: "marked", bookingId, at: updated.at };
    }
    // Lost a race: either a check-in (closed) or a concurrent tap (already).
    const [after] = await tx
      .select({ status: bookings.status, at: bookings.runningLateAt })
      .from(bookings)
      .where(and(eq(bookings.shopId, shopId), eq(bookings.id, bookingId)))
      .limit(1);
    return after?.status === "booked" && after.at
      ? { status: "already", bookingId, at: after.at }
      : { status: "closed" };
  });
}

/**
 * The `/ready` button: this exact seat, which the signed link already named —
 * and, when it is a party organizer's, the party's other seats on the same
 * boat that can still say it. The organizer typed every one of those names
 * and they travel together; a desk that saw one of a family of four late and
 * three blanks would be reading a guess. The outcome is the organizer's own.
 */
export async function markBookingRunningLate(
  db: AppDb,
  input: { shopId: string; bookingId: string; now: Date },
): Promise<RunningLateOutcome> {
  return stampWithParty(db, input.shopId, input.bookingId, input.now);
}

/**
 * **"I'm on time after all"**, from the `/ready` link that said it (third UX
 * review, item 26): a statement made the night before by a stray thumb read
 * "running late" on the arrivals list until the diver checked in. Clears this
 * seat and, for an organizer, the party seats their tap stamped (the same
 * instant, so a member who said it for themselves keeps their own word).
 * Only while the seat could still say it: once the boat has sailed or the
 * diver checked in, the line has stopped mattering and the record stands.
 */
export async function clearBookingRunningLate(
  db: AppDb,
  input: { shopId: string; bookingId: string; now: Date },
): Promise<{ status: "cleared" } | { status: "closed" }> {
  const [row] = await db
    .select({
      status: bookings.status,
      runningLateAt: bookings.runningLateAt,
      tripStatus: trips.status,
      startsAt: trips.startsAt,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(trips.shopId, input.shopId),
        eq(bookings.id, input.bookingId),
        liveTrip(),
      ),
    )
    .limit(1);
  if (
    !row?.runningLateAt ||
    !canSayRunningLate({
      bookingStatus: row.status,
      tripStatus: row.tripStatus,
      startsAt: row.startsAt,
      now: input.now,
    })
  ) {
    return { status: "closed" };
  }
  await db
    .update(bookings)
    .set({ runningLateAt: null })
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.status, "booked"),
        eq(bookings.runningLateAt, row.runningLateAt),
        or(eq(bookings.id, input.bookingId), eq(bookings.partyLeadBookingId, input.bookingId)),
      ),
    );
  return { status: "cleared" };
}

/**
 * One seat, then — when it is a party organizer's — the party's other seats
 * (`partyLeadBookingId`). Every door that names a seat goes through here, so
 * the `/ready` tap, a WhatsApp or email `LATE` and a texted `LATE` cover the
 * same family the same way.
 */
async function stampWithParty(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
  now: Date,
  saidAt: Date = now,
  /** Collects the people of the party seats this call newly stamped. */
  stampedPeople?: string[],
  actorPersonId?: string,
): Promise<RunningLateOutcome> {
  const own = await stamp(db, shopId, bookingId, now, saidAt, actorPersonId);
  if (own.status !== "marked") return own;
  const party = await db
    .select({ id: bookings.id, personId: bookings.personId })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.partyLeadBookingId, bookingId),
        eq(bookings.status, "booked"),
      ),
    );
  for (const seat of party) {
    const stamped = await stamp(db, shopId, seat.id, now, saidAt, actorPersonId);
    if (stamped.status === "marked") stampedPeople?.push(seat.personId);
  }
  return own;
}

/**
 * The seats a person could say "running late" about right now, soonest first.
 * The window is applied in SQL as a bound and again by `canSayRunningLate`.
 */
function openSeatsWhere(now: Date) {
  return and(
    eq(bookings.status, "booked"),
    eq(trips.status, "scheduled"),
    liveTrip(),
    // Not yet sailed: `hasSailed` is the scheduled time plus the buffer.
    gt(trips.startsAt, new Date(now.getTime() - DEPARTURE_BUFFER_MS)),
    lte(trips.startsAt, new Date(now.getTime() + RUNNING_LATE_LEAD_MS)),
  );
}

/**
 * A `LATE` reply from a diver this shop already attributed (WhatsApp or
 * email). **The soonest open seat**, never an ambiguity refusal like `C`'s:
 * cancelling the wrong seat loses one, while "running late" on the morning's
 * first boat is what a diver typing it on the way to the dock means, and it
 * only ever adds a line to a list. An organizer's reply covers the party they
 * booked, as the `/ready` tap does.
 */
export async function markPersonRunningLate(
  db: AppDb,
  input: { shopId: string; personId: string; now: Date },
): Promise<RunningLateOutcome> {
  const [next] = await db
    .select({ bookingId: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(trips.shopId, input.shopId),
        eq(bookings.personId, input.personId),
        openSeatsWhere(input.now),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(1);
  if (!next) return { status: "closed" };
  return stampWithParty(db, input.shopId, next.bookingId, input.now);
}

/**
 * A `LATE` text. The carrier vouches for the phone. When the number it was sent
 * *to* belongs to one shop (`shopId`, from `shopForSmsSender`), this marks that
 * shop's soonest open seat and never another shop's: a diver who is booked at
 * two shops and replies to one shop's reminder is late for that shop (issue
 * #2320). On DiveDay's shared sender nothing names a shop (`shopId` absent or
 * null), so this finds **the soonest open seat held under
 * exactly that number, in any shop**, and every other seat on that same
 * departure held under it: every writer of `people.phone` stores
 * E.164 (`storedPhone`), the same digits the carrier reports. A number on two
 * divers' records, or on none, finds what it finds — the statement gates
 * nothing, and no answer goes back over SMS (ADR 20260907-two-way-inbox,
 * decision 7), so nothing about any booking is disclosed to the sender.
 */
export async function markPhoneRunningLate(
  db: AppDb,
  input: { phone: string; now: Date; shopId?: string | null },
): Promise<RunningLateOutcome> {
  const [next] = await db
    .select({ bookingId: bookings.id, shopId: bookings.shopId, tripId: bookings.tripId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(trips.shopId, bookings.shopId),
        eq(people.shopId, bookings.shopId),
        eq(people.phone, input.phone),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        input.shopId ? eq(bookings.shopId, input.shopId) : undefined,
        openSeatsWhere(input.now),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(1);
  if (!next) return { status: "closed" };
  const outcome = await stampWithParty(db, next.shopId, next.bookingId, input.now);
  // **Every seat on that boat under the same number**: a parent who booked
  // the family with one phone texts once for all of them. Same shop, same
  // departure, same exact digits — never a second boat.
  const family = await db
    .select({ bookingId: bookings.id })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, next.shopId),
        eq(bookings.tripId, next.tripId),
        eq(bookings.status, "booked"),
        eq(people.shopId, next.shopId),
        eq(people.phone, input.phone),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        ne(bookings.id, next.bookingId),
      ),
    );
  for (const seat of family) await stamp(db, next.shopId, seat.bookingId, input.now);
  return outcome;
}

/** The seat a message from this diver could be about, as the Inbox row names it. */
export type MessageSeat = {
  bookingId: string;
  tripId: string;
  title: string;
  startsAt: Date;
  /** Already said, by any door: the row says so and offers nothing. */
  runningLateAt: Date | null;
};

type SeatRow = MessageSeat & { personId: string; tripStatus: string; bookingStatus: string };

/** Every seat these people could still be late for, soonest first. */
async function openSeatsOf(
  db: AppDb,
  shopId: string,
  personIds: readonly string[],
  now: Date,
): Promise<SeatRow[]> {
  if (personIds.length === 0) return [];
  return db
    .select({
      personId: bookings.personId,
      bookingId: bookings.id,
      bookingStatus: bookings.status,
      runningLateAt: bookings.runningLateAt,
      tripId: trips.id,
      tripStatus: trips.status,
      title: trips.title,
      startsAt: trips.startsAt,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(trips.shopId, shopId),
        inArray(bookings.personId, [...new Set(personIds)]),
        openSeatsWhere(now),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(bookings.id));
}

/**
 * **The seats a message could be about** (UX review 2026-10-13, item 19;
 * issue #2551): every one of the sender's seats that is open now *and* was
 * already inside the running-late window when they wrote, soonest first. The
 * second half keeps a "running late" from last Tuesday off this Saturday's
 * boat: the words were about a boat that has gone, and the seats open now are
 * different ones. When more than one is left, the desk chooses; a `LATE`
 * keyword reply, which names no seat, stays the soonest (`markPersonRunningLate`).
 */
function seatsForMessage(seats: readonly SeatRow[], personId: string, receivedAt: Date) {
  return seats.filter(
    (seat) =>
      seat.personId === personId &&
      canSayRunningLate({
        bookingStatus: seat.bookingStatus,
        tripStatus: seat.tripStatus,
        startsAt: seat.startsAt,
        now: receivedAt,
      }),
  );
}

/**
 * The seats each Inbox message could be about, keyed by message id, for the
 * rows of one page. A message that names its booking (an "Ask to move" from
 * the booking page, H-20261014-ask-to-move) is about that one seat, whenever it departs; every
 * other message is read off the sender's open seats (`seatsForMessage`). A
 * message from a stranger, or from a diver with no open seat it could be
 * about, is absent.
 */
export async function messageSeats(
  db: AppDb,
  shopId: string,
  messages: readonly {
    id: string;
    personId: string | null;
    receivedAt: Date;
    bookingId?: string | null;
  }[],
  now: Date,
): Promise<Map<string, MessageSeat[]>> {
  const found = new Map<string, MessageSeat[]>();
  const named = messages.filter((message): message is typeof message & { bookingId: string } =>
    Boolean(message.bookingId),
  );
  if (named.length > 0) {
    const rows = await db
      .select({
        bookingId: bookings.id,
        runningLateAt: bookings.runningLateAt,
        tripId: trips.id,
        title: trips.title,
        startsAt: trips.startsAt,
      })
      .from(bookings)
      .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
      .where(
        and(
          eq(bookings.shopId, shopId),
          inArray(bookings.id, [...new Set(named.map((message) => message.bookingId))]),
        ),
      );
    const byBooking = new Map(rows.map((row) => [row.bookingId, row]));
    for (const message of named) {
      const seat = byBooking.get(message.bookingId);
      if (seat) found.set(message.id, [seat]);
    }
  }
  const attributed = messages.filter(
    (message): message is { id: string; personId: string; receivedAt: Date } =>
      message.personId !== null && !message.bookingId,
  );
  const seats = await openSeatsOf(
    db,
    shopId,
    attributed.map((message) => message.personId),
    now,
  );
  for (const message of attributed) {
    const candidates = seatsForMessage(seats, message.personId, message.receivedAt);
    if (candidates.length > 0) {
      found.set(
        message.id,
        candidates.map(({ bookingId, tripId, title, startsAt, runningLateAt }) => ({
          bookingId,
          tripId,
          title,
          startsAt,
          runningLateAt,
        })),
      );
    }
  }
  return found;
}

/**
 * **A staffer marks it from what the diver wrote** (UX review 2026-10-13,
 * item 19). "Running about 15 min late, traffic on the causeway" is a
 * sentence, and a sentence is never read as a command (ADR
 * 20260909-reply-keywords), so nothing marks it on arrival; the Inbox row
 * names the seat and a person decides. The seat is the one the row named
 * the desk chose among (`seatsForMessage`), the instant stored is when the
 * diver wrote, and an organizer's party travels with them as on every other
 * door.
 *
 * **The booking id is the desk's choice, never trusted** (issue #2551): the
 * candidates are re-derived here from the stored message (person, `receivedAt`)
 * and a booking id that is not among them is refused as `closed`, so a hand-built
 * form can name neither somebody else's seat nor a boat the message was not
 * about.
 *
 * A fresh mark files a line on the diver's record naming the staffer
 * (`running_late_from_message`), because the roster's "said {time}" reads as
 * the diver's own tap otherwise; each party seat the mark stamped gets its own
 * line, in the same transaction as the stamps. A repeat changes nothing and
 * files nothing.
 */
export async function markMessageRunningLate(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    /** The seat the desk chose; refused unless it is one of the message's own. */
    bookingId: string;
    receivedAt: Date;
    now: Date;
    actorPersonId: string;
  },
): Promise<RunningLateOutcome> {
  const seats = await openSeatsOf(db, input.shopId, [input.personId], input.now);
  const seat = seatsForMessage(seats, input.personId, input.receivedAt).find(
    (candidate) => candidate.bookingId === input.bookingId,
  );
  if (!seat) return { status: "closed" };
  // The stamps and the staffer's lines commit together: a mark with no line
  // would read as the diver's own tap, and a line with no mark would lie.
  return db.transaction(async (tx) => {
    const partyPeople: string[] = [];
    const outcome = await stampWithParty(
      tx,
      input.shopId,
      seat.bookingId,
      input.now,
      input.receivedAt,
      partyPeople,
      input.actorPersonId,
    );
    if (outcome.status === "marked") {
      for (const personId of new Set([input.personId, ...partyPeople])) {
        await recordDiverActivity(tx, {
          shopId: input.shopId,
          personId,
          actorPersonId: input.actorPersonId,
          code: "running_late_from_message",
        });
      }
    }
    return outcome;
  });
}
