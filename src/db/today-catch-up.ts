import { and, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { DeskEvent } from "@/lib/desk-events";
import { shopDayBounds } from "@/lib/zoned";
import type { AppDb } from "./client";
import { rosterStillSaysIt } from "./desk-events";
import {
  bookings,
  people,
  todayReadMarkEvents,
  todayReadMarks,
  tripDeskEvents,
  tripHelpRequests,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

type Reader = { shopId: string; personId: string; now: Date; timeZone: string };
type TodayEvent = DeskEvent & { tripId: string; tripTitle: string; tripStartsAt: Date };

/** Exact event IDs matter: sequence numbers can commit out of order. */
export async function readTodayCatchUp(
  db: AppDb,
  input: Reader,
): Promise<{
  mark: { at: Date } | null;
  events: TodayEvent[];
  snapshotIds: string[];
}> {
  const day = shopDayBounds(input.now, input.timeZone);
  const [mark] = await db
    .select({ id: todayReadMarks.id, at: todayReadMarks.lastSeenAt })
    .from(todayReadMarks)
    .where(
      and(
        eq(todayReadMarks.shopId, input.shopId),
        eq(todayReadMarks.personId, input.personId),
        eq(todayReadMarks.dayStart, day.from),
      ),
    )
    .limit(1);
  const rows = await db
    .select({
      id: tripDeskEvents.id,
      kind: tripDeskEvents.kind,
      seq: tripDeskEvents.seq,
      occurredAt: tripDeskEvents.occurredAt,
      subjectName: people.fullName,
      tripId: trips.id,
      tripTitle: trips.title,
      tripStartsAt: trips.startsAt,
    })
    .from(tripDeskEvents)
    .innerJoin(trips, eq(trips.id, tripDeskEvents.tripId))
    .leftJoin(people, eq(people.id, tripDeskEvents.subjectPersonId))
    .leftJoin(
      bookings,
      and(eq(bookings.id, tripDeskEvents.bookingId), eq(bookings.shopId, input.shopId)),
    )
    .leftJoin(
      tripHelpRequests,
      and(
        eq(tripHelpRequests.bookingId, tripDeskEvents.bookingId),
        eq(tripHelpRequests.shopId, input.shopId),
      ),
    )
    .leftJoin(
      todayReadMarkEvents,
      and(
        eq(todayReadMarkEvents.eventId, tripDeskEvents.id),
        mark ? eq(todayReadMarkEvents.markId, mark.id) : sql`false`,
      ),
    )
    .where(
      and(
        eq(tripDeskEvents.shopId, input.shopId),
        eq(trips.shopId, input.shopId),
        liveTrip(),
        gte(trips.startsAt, day.from),
        lt(trips.startsAt, day.to),
        gte(tripDeskEvents.occurredAt, day.from),
        rosterStillSaysIt(),
        or(isNull(tripDeskEvents.actorPersonId), ne(tripDeskEvents.actorPersonId, input.personId)),
        mark ? isNull(todayReadMarkEvents.eventId) : undefined,
      ),
    )
    .orderBy(tripDeskEvents.seq);
  // Before the first view, the snapshot is acknowledged but not presented as news.
  return {
    mark: mark ? { at: mark.at } : null,
    events: mark ? rows : [],
    snapshotIds: rows.map((r) => r.id),
  };
}

/** The caller must authenticate and verify that eventIds came from its rendered snapshot. */
export async function initializeTodayCatchUp(
  db: AppDb,
  input: Reader & { eventIds: string[] },
): Promise<boolean> {
  const day = shopDayBounds(input.now, input.timeZone);
  return db.transaction(async (tx) => {
    const [mark] = await tx
      .insert(todayReadMarks)
      .values({
        shopId: input.shopId,
        personId: input.personId,
        dayStart: day.from,
        lastSeenAt: input.now,
      })
      .onConflictDoNothing()
      .returning({ id: todayReadMarks.id });
    if (!mark) return false;
    await writeAcknowledgements(tx, mark.id, input, day, input.eventIds);
    return true;
  });
}

export async function acknowledgeTodayCatchUp(
  db: AppDb,
  input: Reader & { eventIds: string[] },
): Promise<boolean> {
  const day = shopDayBounds(input.now, input.timeZone);
  return db.transaction(async (tx) => {
    const [mark] = await tx
      .update(todayReadMarks)
      .set({ lastSeenAt: sql`greatest(${todayReadMarks.lastSeenAt}, ${input.now})` })
      .where(
        and(
          eq(todayReadMarks.shopId, input.shopId),
          eq(todayReadMarks.personId, input.personId),
          eq(todayReadMarks.dayStart, day.from),
        ),
      )
      .returning({ id: todayReadMarks.id });
    if (!mark) return false;
    await writeAcknowledgements(tx, mark.id, input, day, input.eventIds);
    return true;
  });
}

async function writeAcknowledgements(
  db: Parameters<Parameters<AppDb["transaction"]>[0]>[0],
  markId: string,
  input: Reader,
  day: { from: Date; to: Date },
  eventIds: string[],
): Promise<void> {
  if (!eventIds.length) return;
  const rows = await db
    .select({ id: tripDeskEvents.id })
    .from(tripDeskEvents)
    .innerJoin(trips, eq(trips.id, tripDeskEvents.tripId))
    .where(
      and(
        inArray(tripDeskEvents.id, eventIds),
        eq(tripDeskEvents.shopId, input.shopId),
        eq(trips.shopId, input.shopId),
        liveTrip(),
        gte(trips.startsAt, day.from),
        lt(trips.startsAt, day.to),
        gte(tripDeskEvents.occurredAt, day.from),
      ),
    )
    .orderBy(tripDeskEvents.id)
    .for("key share", { of: tripDeskEvents });
  if (rows.length)
    await db
      .insert(todayReadMarkEvents)
      .values(rows.map(({ id }) => ({ markId, eventId: id })))
      .onConflictDoNothing();
}
