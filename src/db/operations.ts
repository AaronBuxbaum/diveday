import { and, asc, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { isUuid } from "@/lib/uuid";
import type { AppDb } from "./client";
import { offsetPage, PAGE_SIZE } from "./paging";
import { activityEvents, bookings, internalNotes, people, trips } from "./schema";
import { liveTrip } from "./trips-live";

export async function addInternalNote(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    bookingId: string;
    actorPersonId: string;
    body: string;
  },
) {
  if (![input.shopId, input.tripId, input.bookingId, input.actorPersonId].every(isUuid))
    return null;
  const body = input.body.trim();
  if (!body || body.length > 1_000) return null;
  return db.transaction(async (tx) => {
    const [scope] = await tx
      .select({ personId: bookings.personId, tripId: bookings.tripId, diverName: people.fullName })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.tripId, input.tripId),
          eq(bookings.shopId, input.shopId),
          eq(trips.shopId, input.shopId),
        ),
      )
      .limit(1);
    const [actor] = await tx
      .select({ name: people.fullName })
      .from(people)
      .where(and(eq(people.id, input.actorPersonId), eq(people.shopId, input.shopId)))
      .limit(1);
    if (!scope || !actor) return null;
    const [note] = await tx
      .insert(internalNotes)
      .values({
        shopId: input.shopId,
        bookingId: input.bookingId,
        personId: scope.personId,
        createdByPersonId: input.actorPersonId,
        body,
      })
      .returning();
    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: scope.tripId,
      bookingId: input.bookingId,
      actorPersonId: input.actorPersonId,
      message: `${actor.name} added a private note about ${scope.diverName}`,
      occurredAt: nowDate(),
    });
    return note ?? null;
  });
}

/**
 * Add a note to the diver record rather than to one booking. The same
 * staff-only record can then be read from the diver page and from any boat
 * manifest that carries that diver, without copying text between surfaces.
 * Notes are context only: no readiness, boarding, capacity, or checkpoint
 * decision reads them.
 */
export async function addDiverNote(
  db: AppDb,
  input: { shopId: string; personId: string; actorPersonId: string; body: string },
) {
  if (![input.shopId, input.personId, input.actorPersonId].every(isUuid)) return null;
  const body = input.body.trim();
  if (!body || body.length > 1_000) return null;
  return db.transaction(async (tx) => {
    const [diver] = await tx
      .select({ name: people.fullName })
      .from(people)
      .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
      .limit(1);
    const [actor] = await tx
      .select({ name: people.fullName })
      .from(people)
      .where(and(eq(people.id, input.actorPersonId), eq(people.shopId, input.shopId)))
      .limit(1);
    if (!diver || !actor) return null;
    const [note] = await tx
      .insert(internalNotes)
      .values({
        shopId: input.shopId,
        personId: input.personId,
        bookingId: null,
        createdByPersonId: input.actorPersonId,
        body,
      })
      .returning();
    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: null,
      bookingId: null,
      actorPersonId: input.actorPersonId,
      // The seat-shaped handles are both null here, so the subject is the only
      // thing tying this line to the record it was written on.
      subjectPersonId: input.personId,
      message: `${actor.name} added a private note about ${diver.name}`,
      occurredAt: nowDate(),
    });
    return note ?? null;
  });
}

/**
 * One line on the diver-record trail, subject-only — the same shape
 * `addDiverNote` above writes for itself, pulled out because a second caller
 * needed it (issue #726: recording that a diver's own record was exported).
 * Both handles are null, same reason as `addDiverNote`'s own comment: the
 * subject is what ties this line to the record it was written on, not a trip
 * or a booking.
 */
export async function recordDiverActivity(
  db: AppDb,
  input: { shopId: string; personId: string; actorPersonId: string; action: string },
): Promise<boolean> {
  const [diver] = await db
    .select({ name: people.fullName })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  const [actor] = await db
    .select({ name: people.fullName })
    .from(people)
    .where(and(eq(people.id, input.actorPersonId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!diver || !actor) return false;
  await db.insert(activityEvents).values({
    shopId: input.shopId,
    tripId: null,
    bookingId: null,
    actorPersonId: input.actorPersonId,
    subjectPersonId: input.personId,
    message: `${actor.name} ${input.action} ${diver.name}`,
    occurredAt: nowDate(),
  });
  return true;
}

/**
 * Return-what-you-deleted, same convention as `deleteRecapPhoto`
 * (`DeleteRecapPhotoResult`): the caller needs the booking + text back to
 * offer a one-tap undo that recreates the note (docs/design/principles.md
 * §7) — a purely reversible edit, unlike the money-moving actions on this
 * page that keep a blocking confirm.
 */
export type DeleteInternalNoteResult =
  | { deleted: true; bookingId: string; body: string }
  | { deleted: false };

export async function deleteInternalNote(
  db: AppDb,
  input: { shopId: string; tripId: string; noteId: string; actorPersonId: string },
): Promise<DeleteInternalNoteResult> {
  if (![input.shopId, input.tripId, input.noteId, input.actorPersonId].every(isUuid)) {
    return { deleted: false };
  }
  return db.transaction(async (tx) => {
    const [note] = await tx
      .select({
        // `bookings.id`, not the nullable `internalNotes.bookingId` column —
        // the inner join below already guarantees a match, so this is the
        // non-null value `DeleteInternalNoteResult` promises callers.
        bookingId: bookings.id,
        body: internalNotes.body,
        tripId: bookings.tripId,
        diverName: people.fullName,
      })
      .from(internalNotes)
      .innerJoin(bookings, eq(bookings.id, internalNotes.bookingId))
      .innerJoin(people, eq(people.id, internalNotes.personId))
      .where(
        and(
          eq(internalNotes.id, input.noteId),
          eq(internalNotes.shopId, input.shopId),
          eq(bookings.tripId, input.tripId),
        ),
      )
      .limit(1);
    if (!note) return { deleted: false };
    const [actor] = await tx
      .select({ name: people.fullName })
      .from(people)
      .where(and(eq(people.id, input.actorPersonId), eq(people.shopId, input.shopId)))
      .limit(1);
    if (!actor) return { deleted: false };
    await tx
      .delete(internalNotes)
      .where(and(eq(internalNotes.id, input.noteId), eq(internalNotes.shopId, input.shopId)));
    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: note.tripId,
      bookingId: note.bookingId,
      actorPersonId: input.actorPersonId,
      message: `${actor.name} deleted a private note about ${note.diverName}`,
      occurredAt: nowDate(),
    });
    return { deleted: true, bookingId: note.bookingId, body: note.body };
  });
}

export type DeleteDiverNoteResult = { deleted: true; body: string } | { deleted: false };

/** Delete a person-scoped note; the caller can offer a one-tap undo. */
export async function deleteDiverNote(
  db: AppDb,
  input: { shopId: string; personId: string; noteId: string; actorPersonId: string },
): Promise<DeleteDiverNoteResult> {
  if (![input.shopId, input.personId, input.noteId, input.actorPersonId].every(isUuid)) {
    return { deleted: false };
  }
  return db.transaction(async (tx) => {
    const [note] = await tx
      .select({ body: internalNotes.body, diverName: people.fullName })
      .from(internalNotes)
      .innerJoin(people, eq(people.id, internalNotes.personId))
      .where(
        and(
          eq(internalNotes.id, input.noteId),
          eq(internalNotes.shopId, input.shopId),
          eq(internalNotes.personId, input.personId),
          isNull(internalNotes.bookingId),
        ),
      )
      .limit(1);
    if (!note) return { deleted: false };
    const [actor] = await tx
      .select({ name: people.fullName })
      .from(people)
      .where(and(eq(people.id, input.actorPersonId), eq(people.shopId, input.shopId)))
      .limit(1);
    if (!actor) return { deleted: false };
    await tx
      .delete(internalNotes)
      .where(
        and(
          eq(internalNotes.id, input.noteId),
          eq(internalNotes.shopId, input.shopId),
          eq(internalNotes.personId, input.personId),
          isNull(internalNotes.bookingId),
        ),
      );
    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: null,
      bookingId: null,
      actorPersonId: input.actorPersonId,
      subjectPersonId: input.personId,
      message: `${actor.name} deleted a private note about ${note.diverName}`,
      occurredAt: nowDate(),
    });
    return { deleted: true, body: note.body };
  });
}

export async function listBookingNotes(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({ note: internalNotes, authorName: people.fullName })
    .from(internalNotes)
    .innerJoin(bookings, eq(bookings.id, internalNotes.bookingId))
    .innerJoin(people, eq(people.id, internalNotes.createdByPersonId))
    .where(and(eq(internalNotes.shopId, shopId), eq(bookings.tripId, tripId)))
    .orderBy(asc(internalNotes.createdAt));
}

/** Notes written on the diver record, oldest first. */
export async function listDiverNotes(db: AppDb, shopId: string, personId: string) {
  return db
    .select({ note: internalNotes, authorName: people.fullName })
    .from(internalNotes)
    .innerJoin(people, eq(people.id, internalNotes.createdByPersonId))
    .where(
      and(
        eq(internalNotes.shopId, shopId),
        eq(internalNotes.personId, personId),
        isNull(internalNotes.bookingId),
      ),
    )
    .orderBy(asc(internalNotes.createdAt));
}

/**
 * Every staff note about one diver, in one chronological record.
 *
 * `internal_notes` already holds both scopes: a person-scoped note has no
 * booking, while a trip note has the booking and therefore its departure.
 * The diver record is the one place staff need the complete story, so it
 * reads both shapes and carries the booking context as metadata instead of
 * copying a trip note into a second note system.
 */
export async function listDiverRecordNotes(db: AppDb, shopId: string, personId: string) {
  return db
    .select({
      note: internalNotes,
      authorName: people.fullName,
      tripId: trips.id,
      tripTitle: trips.title,
      tripStartsAt: trips.startsAt,
    })
    .from(internalNotes)
    .innerJoin(people, eq(people.id, internalNotes.createdByPersonId))
    .leftJoin(bookings, eq(bookings.id, internalNotes.bookingId))
    .leftJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .where(and(eq(internalNotes.shopId, shopId), eq(internalNotes.personId, personId)))
    .orderBy(asc(internalNotes.createdAt));
}

/**
 * Resolve diver-scoped notes onto the booking that represents that diver on a
 * trip. This is the bridge that lets the Diver page and boat manifest share
 * one source of truth without making a diver note belong to a single booking.
 */
export async function listDiverNotesForTrip(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({ note: internalNotes, authorName: people.fullName, bookingId: bookings.id })
    .from(internalNotes)
    .innerJoin(bookings, eq(bookings.personId, internalNotes.personId))
    .innerJoin(people, eq(people.id, internalNotes.createdByPersonId))
    .where(
      and(
        eq(internalNotes.shopId, shopId),
        isNull(internalNotes.bookingId),
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
      ),
    )
    .orderBy(asc(internalNotes.createdAt));
}

/**
 * A trip's activity trail, newest first.
 *
 * Ordered by `seq` as well as time, because `occurred_at` ties constantly: two
 * events written in one request share an instant (deleting a note records its
 * own event beside the add's), and the e2e clock is frozen so every event in a
 * test carries the identical timestamp. Ordering on time alone left the tie to
 * whatever the heap returned, which changes whenever rows move — the trail
 * then reads backwards, "deleted a private note" sitting above the "added" it
 * followed. `seq` is the only column here that records what actually came
 * first (`id` is `defaultRandom()`).
 */
export async function listTripActivity(db: AppDb, shopId: string, tripId: string) {
  return db
    .select()
    .from(activityEvents)
    .where(and(eq(activityEvents.shopId, shopId), eq(activityEvents.tripId, tripId)))
    .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.seq))
    .limit(50);
}

/** How many lines of a diver's trail the record shows at a time. */
export const DIVER_ACTIVITY_PAGE_SIZE = PAGE_SIZE.section;

/**
 * Everything in the shop's activity trail that is **about one person**, newest
 * first, one page at a time.
 *
 * Three things make an event theirs, and the set is not arbitrary — it is
 * exactly the predicate `anonymizeDiver` redacts under (`src/db/anonymize.ts`),
 * so the set a shop can read here and the set an erasure destroys are the same
 * set by construction:
 *
 * - it happened **to a seat of theirs** (`booking_id` is one of their bookings),
 * - or they **did** it (`actor_person_id`) — a divemaster's own trail across
 *   every boat they ran,
 * - or it is **about them** (`subject_person_id`) — a note written on their
 *   record, which hangs off no seat at all.
 *
 * A clause added here is added to that sweep in the same change or not at all.
 * Widening the reader alone would leave lines readable on a record *after* an
 * erasure had run, which is the exact failure the pairing exists to prevent.
 *
 * Nothing is redacted at read time and nothing needs to be: an erased person's
 * lines already read `[redacted]` in the table, written once inside the erasure
 * transaction. A reader that filtered instead would be a second, weaker copy of
 * that rule, and the weaker copy is the one that gets forgotten.
 *
 * Scoped by the caller's `shopId` on the events *and* on the booking subquery,
 * so a person id belonging to another tenant selects nothing rather than
 * leaking one shop's trail through the other's `personId`.
 *
 * Paged rather than capped: a returning diver accumulates lines for as long as
 * they dive with the shop, and a list with no end is the surface that
 * photographs 17,000px tall. `seq` breaks the constant `occurred_at` ties for
 * the same reason `listTripActivity` above does.
 */
export async function pagedDiverActivity(
  db: AppDb,
  shopId: string,
  personId: string,
  options: { page?: number; pageSize?: number } = {},
) {
  // Postgres *raises* on a malformed literal compared against a `uuid` column
  // rather than selecting nothing, so an unguarded id is a 500 where an empty
  // trail belongs — the same hazard `uuidParam` covers on a route segment.
  // Both writers above guard this way; this reader's only caller narrows its
  // segment today, and the next one may not.
  const usable = isUuid(shopId) && isUuid(personId);
  const theirs = and(
    eq(activityEvents.shopId, shopId),
    or(
      inArray(
        activityEvents.bookingId,
        db
          .select({ id: bookings.id })
          .from(bookings)
          .where(and(eq(bookings.shopId, shopId), eq(bookings.personId, personId))),
      ),
      eq(activityEvents.actorPersonId, personId),
      eq(activityEvents.subjectPersonId, personId),
    ),
  );
  return offsetPage({
    page: options.page,
    pageSize: options.pageSize ?? DIVER_ACTIVITY_PAGE_SIZE,
    countRows: async () => {
      if (!usable) return 0;
      const [row] = await db.select({ count: count() }).from(activityEvents).where(theirs);
      return row?.count ?? 0;
    },
    fetchRows: async (offset, limit) =>
      usable
        ? await db
            .select()
            .from(activityEvents)
            .where(theirs)
            .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.seq))
            .limit(limit)
            .offset(offset)
        : [],
  });
}

export async function recordTripActivity(
  db: AppDb,
  input: { shopId: string; tripId: string; actorPersonId: string; action: string },
) {
  const action = input.action.trim();
  if (!action || action.length > 500) return null;
  const [scope] = await db
    .select({ actorName: people.fullName })
    .from(trips)
    .innerJoin(people, eq(people.id, input.actorPersonId))
    .where(
      and(
        liveTrip(),
        eq(trips.id, input.tripId),
        eq(trips.shopId, input.shopId),
        eq(people.shopId, input.shopId),
      ),
    )
    .limit(1);
  if (!scope) return null;
  const [event] = await db
    .insert(activityEvents)
    .values({
      shopId: input.shopId,
      tripId: input.tripId,
      actorPersonId: input.actorPersonId,
      message: `${scope.actorName} ${action}`,
      occurredAt: nowDate(),
    })
    .returning();
  return event ?? null;
}
