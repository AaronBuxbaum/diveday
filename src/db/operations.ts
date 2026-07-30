import { and, asc, desc, eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb } from "./client";
import { activityEvents, bookings, internalNotes, people, trips } from "./schema";

export async function addInternalNote(
  db: AppDb,
  input: { shopId: string; bookingId: string; actorPersonId: string; body: string },
) {
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

export async function deleteInternalNote(
  db: AppDb,
  input: { shopId: string; noteId: string; actorPersonId: string },
) {
  return db.transaction(async (tx) => {
    const [note] = await tx
      .select({
        bookingId: internalNotes.bookingId,
        tripId: bookings.tripId,
        diverName: people.fullName,
      })
      .from(internalNotes)
      .innerJoin(bookings, eq(bookings.id, internalNotes.bookingId))
      .innerJoin(people, eq(people.id, internalNotes.personId))
      .where(and(eq(internalNotes.id, input.noteId), eq(internalNotes.shopId, input.shopId)))
      .limit(1);
    if (!note) return false;
    const [actor] = await tx
      .select({ name: people.fullName })
      .from(people)
      .where(and(eq(people.id, input.actorPersonId), eq(people.shopId, input.shopId)))
      .limit(1);
    if (!actor) return false;
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
    return true;
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

export async function listTripActivity(db: AppDb, shopId: string, tripId: string) {
  return db
    .select()
    .from(activityEvents)
    .where(and(eq(activityEvents.shopId, shopId), eq(activityEvents.tripId, tripId)))
    .orderBy(desc(activityEvents.occurredAt))
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
