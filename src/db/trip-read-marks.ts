import { and, eq, gt, inArray, isNull, max, ne, not, notInArray, or, sql } from "drizzle-orm";
import { catchUpKind, DESK_FLAGGED_CODES, deskCodesFeeding } from "@/lib/activity";
import type { CatchUpEvent } from "@/lib/catch-up";
import { nowDate } from "@/lib/clock";
import { seatCheckedIn } from "./arrival-provenance";
import type { AppDb, DbExecutor } from "./client";
import { activityEvents, bookings, people, tripHelpRequests, tripReadMarks, trips } from "./schema";
import { liveTrip } from "./trips-live";
import { seatNotCancelled } from "./trips-queries";

/**
 * **The shift catch-up strip's marks and reader** (issues #1202, #1187 and
 * #2701): where each person had read up to on a departure, and the desk lines
 * after it.
 *
 * A desk line is an `activity_events` row whose code `src/lib/activity.ts`
 * flags for the desk (`catchUpKind`): a desk-only code, or a trail code such as
 * a check-in whose one row both the trail and the strip read. The strip's
 * staff-only rows sit in the trail's table, so every read here is staff-only
 * and filters to the desk codes by `DESK_FLAGGED_CODES`; no diver-facing
 * surface imports this module.
 *
 * Rows and codes, never sentences: the words are `src/i18n/activity-labels.ts`
 * (`catchUpSentences`) and the grouping is `src/lib/catch-up.ts`.
 */

/** A row the catch-up strip reads: its code is flagged for the desk. */
export function deskLine() {
  return inArray(activityEvents.code, [...DESK_FLAGGED_CODES]);
}

/**
 * Move a read mark forward, never back. A staffer who acted on a departure in
 * one tab and tapped *Got it* in another must not be shown the intervening
 * lines again because the older write landed second.
 */
export async function advanceReadMark(
  db: DbExecutor,
  input: { shopId: string; tripId: string; personId: string; seq: number; now: Date },
): Promise<void> {
  await db
    .insert(tripReadMarks)
    .values({
      shopId: input.shopId,
      tripId: input.tripId,
      personId: input.personId,
      lastSeenSeq: input.seq,
      lastSeenAt: input.now,
    })
    .onConflictDoUpdate({
      target: [tripReadMarks.tripId, tripReadMarks.personId],
      set: {
        lastSeenSeq: sql`greatest(${tripReadMarks.lastSeenSeq}, excluded.last_seen_seq)`,
        lastSeenAt: input.now,
      },
    });
}

/**
 * Give a person their first mark on a departure at their own act, and never
 * move one they already have (issue #3886).
 *
 * Called by the activity recorder (`recordActivityRow`, `src/db/operations.ts`)
 * for every desk line with an actor, in the same executor. Catching up starts
 * once you have acted or acknowledged, so a first act opens the strip. A later
 * act must not carry the mark forward: Ben, read up to 90, who checks in Carlos
 * at 100 has still not read Ana's ask for a hand at 95. The reader already
 * leaves out a person's own lines, so nobody is told about what they just did.
 */
export async function startReadMark(
  db: DbExecutor,
  input: { shopId: string; tripId: string; personId: string; seq: number; now: Date },
): Promise<void> {
  await db
    .insert(tripReadMarks)
    .values({
      shopId: input.shopId,
      tripId: input.tripId,
      personId: input.personId,
      lastSeenSeq: input.seq,
      lastSeenAt: input.now,
    })
    .onConflictDoNothing({ target: [tripReadMarks.tripId, tripReadMarks.personId] });
}

export type TripCatchUp = {
  /** Where this person had read up to, or null when they never have. */
  mark: { seq: number; at: Date } | null;
  events: CatchUpEvent[];
};

/**
 * What one person has not seen on one departure.
 *
 * **A person with no mark gets nothing**, even on a departure with ten desk
 * lines. There is nothing for the strip to be "since", and the alternative —
 * writing a mark during the render — is a mutation inside a read Next forbids,
 * or a write-on-mount effect that races the first act of the morning. A first
 * visit is reading; catching up starts once you have acted or acknowledged.
 *
 * The reader never sees their own acts, the trip is scoped through
 * {@link liveTrip} so a departure taken off the board says nothing, and the
 * subject's name is **joined live** rather than read from the line's names —
 * a desk-only line carries none, and an erasure redacts a flagged trail line
 * to a code the strip does not read.
 *
 * **A roster line is said only while the roster still says it** (UX review
 * 2026-10-13, item 3). The strip sits above the head count on the manifest,
 * so "Priya has checked in" over a roll call that has her at the counter's
 * start is a contradiction on a safety surface. An arrival is read through
 * the seat it names and kept only while that seat is checked in on this
 * departure (`seatCheckedIn`, the arrival trail the roster and the counter
 * read) — so an undone check-in takes its line with it, and so does a seat
 * moved to another boat. A seat taken is kept only while the seat is still
 * held, and a diver's ask for a hand only while that ask is still open
 * (`trip_help_requests`, the row Today reads). The append-only rows are
 * untouched; the reader filters, so the trail stays whole.
 */
export async function listCatchUpSince(
  db: AppDb,
  shopId: string,
  tripId: string,
  personId: string,
): Promise<TripCatchUp> {
  const [mark] = await db
    .select({ seq: tripReadMarks.lastSeenSeq, at: tripReadMarks.lastSeenAt })
    .from(tripReadMarks)
    .innerJoin(trips, eq(trips.id, tripReadMarks.tripId))
    .where(
      and(
        eq(tripReadMarks.shopId, shopId),
        eq(tripReadMarks.tripId, tripId),
        eq(tripReadMarks.personId, personId),
        eq(trips.shopId, shopId),
        liveTrip(),
      ),
    )
    .limit(1);
  if (!mark) return { mark: null, events: [] };

  const rows = await db
    .select({
      code: activityEvents.code,
      params: activityEvents.params,
      seq: activityEvents.seq,
      occurredAt: activityEvents.occurredAt,
      subjectName: people.fullName,
    })
    .from(activityEvents)
    .innerJoin(trips, eq(trips.id, activityEvents.tripId))
    .leftJoin(people, and(eq(people.id, activityEvents.subjectPersonId), eq(people.shopId, shopId)))
    .leftJoin(bookings, and(eq(bookings.id, activityEvents.bookingId), eq(bookings.shopId, shopId)))
    .leftJoin(
      tripHelpRequests,
      and(
        eq(tripHelpRequests.bookingId, activityEvents.bookingId),
        eq(tripHelpRequests.shopId, shopId),
      ),
    )
    .where(
      and(
        eq(activityEvents.shopId, shopId),
        eq(activityEvents.tripId, tripId),
        eq(activityEvents.audience, "staff"),
        deskLine(),
        eq(trips.shopId, shopId),
        liveTrip(),
        gt(activityEvents.seq, mark.seq),
        rosterStillSaysIt(),
        // The manifest's roster says who is running late on every row; the
        // strip does not repeat it (Today's catch-up does).
        notInArray(activityEvents.code, deskCodesFeeding("running_late")),
        // A null actor is a diver acting on their own link, which is news to
        // every staffer — `ne` alone would drop those rows, since SQL's
        // three-valued logic makes `null <> '…'` neither true nor false.
        or(isNull(activityEvents.actorPersonId), ne(activityEvents.actorPersonId, personId)),
      ),
    )
    .orderBy(activityEvents.seq);

  return { mark, events: asCatchUpEvents(rows) };
}

/** Read each row's code as the sentence it feeds, dropping any that feeds none. */
export function asCatchUpEvents<
  Row extends { code: string; params: unknown; seq: number; occurredAt: Date },
>(rows: readonly Row[]): (Omit<Row, "code" | "params"> & CatchUpEvent)[] {
  return rows.flatMap(({ code, params, ...row }) => {
    const kind = catchUpKind(code, params);
    return kind ? [{ ...row, kind } as Omit<Row, "code" | "params"> & CatchUpEvent] : [];
  });
}

/**
 * The four kinds the strip may only say while the rows behind them still
 * bear them out (see {@link listCatchUpSince}). Every other kind is a
 * statement about something that happened, which stays true once it has.
 */
export function rosterStillSaysIt() {
  return and(
    or(
      notInArray(activityEvents.code, deskCodesFeeding("running_late")),
      and(
        eq(bookings.tripId, activityEvents.tripId),
        eq(bookings.status, "booked"),
        sql`${bookings.runningLateAt} is not null`,
        // Seen at the desk is not late, whatever the stamp says.
        not(seatCheckedIn),
      ),
    ),
    or(
      notInArray(activityEvents.code, deskCodesFeeding("arrival")),
      and(eq(bookings.tripId, activityEvents.tripId), seatCheckedIn),
    ),
    or(
      notInArray(activityEvents.code, deskCodesFeeding("seat_taken")),
      and(eq(bookings.tripId, activityEvents.tripId), seatNotCancelled),
    ),
    or(
      notInArray(activityEvents.code, deskCodesFeeding("help_request")),
      inArray(tripHelpRequests.status, ["requested", "acknowledged"]),
    ),
  );
}

/**
 * *Got it.* Move this person's mark to the end of the departure's lines —
 * `max(seq)`, read here rather than sent up from the page, so an act landing
 * between the strip's render and the tap is not silently swallowed by a stale
 * number the browser was holding.
 *
 * Re-proves the departure against the shop before it writes: the tap arrives
 * from a client, and a mark row is a foreign-key-shaped write nobody else
 * scopes. A departure that is not this shop's, or is off the board, writes
 * nothing and says so — the surface has nothing to do with the answer either
 * way.
 */
export async function markTripCaughtUp(
  db: AppDb,
  input: { shopId: string; tripId: string; personId: string; now?: Date },
): Promise<boolean> {
  const now = input.now ?? nowDate();
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!trip) return false;
  const [latest] = await db
    .select({ seq: max(activityEvents.seq) })
    .from(activityEvents)
    .where(and(eq(activityEvents.shopId, input.shopId), eq(activityEvents.tripId, input.tripId)));
  await advanceReadMark(db, {
    shopId: input.shopId,
    tripId: input.tripId,
    personId: input.personId,
    seq: latest?.seq ?? 0,
    now,
  });
  return true;
}
