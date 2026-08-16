import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { isUuid } from "@/lib/uuid";
import type { AppDb } from "./client";
import { activityEvents, bookings, internalNotes, people, trips } from "./schema";

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
      message: `${actor.name} added a diver note about ${diver.name}`,
      occurredAt: nowDate(),
    });
    return note ?? null;
  });
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
      message: `${actor.name} deleted a diver note about ${note.diverName}`,
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
