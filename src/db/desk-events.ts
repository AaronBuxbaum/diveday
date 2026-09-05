import { and, eq, gt, isNull, max, ne, or, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { DeskEvent, DeskEventKind } from "@/lib/desk-events";
import type { AppDb, DbExecutor } from "./client";
import { people, tripDeskEvents, tripReadMarks, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * The shift catch-up strip's reader and writers (issues #1202 and #1187).
 *
 * Rows and codes, never sentences: the words are `src/i18n/desk-event-labels.ts`
 * and the grouping is `src/lib/desk-events.ts`.
 */

export type RecordDeskEventInput = {
  shopId: string;
  tripId: string;
  kind: DeskEventKind;
  bookingId?: string | null;
  /** The diver the line is about; null for the two trip-wide kinds. */
  subjectPersonId?: string | null;
  /** Who did it, when a person did — null for a diver acting on their own link. */
  actorPersonId?: string | null;
  occurredAt?: Date;
};

/**
 * Append one desk act, and move the actor's own read mark past it.
 *
 * The second half is not an optimisation. Without it the person who just seated
 * a walk-in would open the manifest and be told about their own act — and worse,
 * a staffer whose only interaction with a departure is doing things to it would
 * accumulate a strip made entirely of themselves. Advancing the mark in the same
 * executor makes "you are not behind on what you just did" a property of the
 * write rather than a filter somebody has to remember at every read.
 *
 * Takes a {@link DbExecutor} so a caller inside a transaction writes the event
 * with the act that caused it — a handoff line that silently went missing is
 * worse than a save a staffer can retry.
 */
export async function recordDeskEvent(db: DbExecutor, input: RecordDeskEventInput): Promise<void> {
  const occurredAt = input.occurredAt ?? nowDate();
  const [row] = await db
    .insert(tripDeskEvents)
    .values({
      shopId: input.shopId,
      tripId: input.tripId,
      kind: input.kind,
      bookingId: input.bookingId ?? null,
      subjectPersonId: input.subjectPersonId ?? null,
      actorPersonId: input.actorPersonId ?? null,
      occurredAt,
    })
    .returning({ seq: tripDeskEvents.seq });
  if (!row || !input.actorPersonId) return;
  await upsertReadMark(db, {
    shopId: input.shopId,
    tripId: input.tripId,
    personId: input.actorPersonId,
    seq: row.seq,
    now: occurredAt,
  });
}

/**
 * Move a read mark forward, never back. A staffer who acted on a departure in
 * one tab and tapped *Got it* in another must not be shown the intervening
 * events again because the older write landed second.
 */
async function upsertReadMark(
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

export type DeskCatchUp = {
  /** Where this person had read up to, or null when they never have. */
  mark: { seq: number; at: Date } | null;
  events: DeskEvent[];
};

/**
 * What one person has not seen on one departure.
 *
 * **A person with no mark gets nothing**, even on a departure with ten desk
 * events. There is nothing for the strip to be "since", and the alternative —
 * writing a mark during the render — is a mutation inside a read Next forbids,
 * or a write-on-mount effect that races the first act of the morning. A first
 * visit is reading; catching up starts once you have acted or acknowledged.
 *
 * The reader never sees their own acts, the trip is scoped through
 * {@link liveTrip} so a departure taken off the board says nothing, and the
 * subject's name is **joined live** rather than frozen into the event row —
 * which is what makes `anonymizeDiver` reach this surface with no sweep of its
 * own.
 */
export async function listDeskEventsSince(
  db: AppDb,
  shopId: string,
  tripId: string,
  personId: string,
): Promise<DeskCatchUp> {
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
      kind: tripDeskEvents.kind,
      seq: tripDeskEvents.seq,
      occurredAt: tripDeskEvents.occurredAt,
      subjectName: people.fullName,
    })
    .from(tripDeskEvents)
    .innerJoin(trips, eq(trips.id, tripDeskEvents.tripId))
    .leftJoin(people, eq(people.id, tripDeskEvents.subjectPersonId))
    .where(
      and(
        eq(tripDeskEvents.shopId, shopId),
        eq(tripDeskEvents.tripId, tripId),
        eq(trips.shopId, shopId),
        liveTrip(),
        gt(tripDeskEvents.seq, mark.seq),
        // A null actor is a diver acting on their own link, which is news to
        // every staffer — `ne` alone would drop those rows, since SQL's
        // three-valued logic makes `null <> '…'` neither true nor false.
        or(isNull(tripDeskEvents.actorPersonId), ne(tripDeskEvents.actorPersonId, personId)),
      ),
    )
    .orderBy(tripDeskEvents.seq);

  return { mark, events: rows };
}

/**
 * *Got it.* Move this person's mark to the end of the departure's events —
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
    .select({ seq: max(tripDeskEvents.seq) })
    .from(tripDeskEvents)
    .where(and(eq(tripDeskEvents.shopId, input.shopId), eq(tripDeskEvents.tripId, input.tripId)));
  await upsertReadMark(db, {
    shopId: input.shopId,
    tripId: input.tripId,
    personId: input.personId,
    seq: latest?.seq ?? 0,
    now,
  });
  return true;
}
