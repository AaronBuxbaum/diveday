import { and, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { liveTrip } from "@/db/trips";
import type { AppDb } from "../../db/client";
import {
  activityEvents,
  bookings,
  people,
  todayReadMarkEvents,
  todayReadMarks,
  tripHelpRequests,
  trips,
} from "../../db/schema/index";
import { asCatchUpEvents, deskLine, rosterStillSaysIt } from "../../db/trip-read-marks";
import type { CatchUpEvent } from "../../lib/catch-up";
import { shopDayBounds } from "../../lib/zoned";

type Reader = { shopId: string; personId: string; now: Date; timeZone: string };
type TodayEvent = CatchUpEvent & {
  id: string;
  tripId: string;
  tripTitle: string;
  tripStartsAt: Date;
};

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
      id: activityEvents.id,
      code: activityEvents.code,
      params: activityEvents.params,
      seq: activityEvents.seq,
      occurredAt: activityEvents.occurredAt,
      subjectName: people.fullName,
      tripId: trips.id,
      tripTitle: trips.title,
      tripStartsAt: trips.startsAt,
    })
    .from(activityEvents)
    // diveday:allow-staff-events: The signed-in staff catch-up queue explicitly reads staff audience rows for this shop.

    .innerJoin(trips, eq(trips.id, activityEvents.tripId))
    .leftJoin(
      people,
      and(eq(people.id, activityEvents.subjectPersonId), eq(people.shopId, input.shopId)),
    )
    .leftJoin(
      bookings,
      and(eq(bookings.id, activityEvents.bookingId), eq(bookings.shopId, input.shopId)),
    )
    .leftJoin(
      tripHelpRequests,
      and(
        eq(tripHelpRequests.bookingId, activityEvents.bookingId),
        eq(tripHelpRequests.shopId, input.shopId),
      ),
    )
    .leftJoin(
      todayReadMarkEvents,
      and(
        eq(todayReadMarkEvents.eventId, activityEvents.id),
        eq(todayReadMarkEvents.shopId, input.shopId),
        mark ? eq(todayReadMarkEvents.markId, mark.id) : sql`false`,
      ),
    )
    .where(
      and(
        eq(activityEvents.shopId, input.shopId),
        eq(activityEvents.audience, "staff"),
        deskLine(),
        eq(trips.shopId, input.shopId),
        liveTrip(),
        gte(trips.startsAt, day.from),
        lt(trips.startsAt, day.to),
        gte(activityEvents.occurredAt, day.from),
        rosterStillSaysIt(),
        or(isNull(activityEvents.actorPersonId), ne(activityEvents.actorPersonId, input.personId)),
        mark ? isNull(todayReadMarkEvents.eventId) : undefined,
      ),
    )
    .orderBy(activityEvents.seq);
  // A row whose names feed no sentence (a seat moved away after it was turned
  // away) is no line at all, so it is neither shown nor acknowledged.
  const events = asCatchUpEvents(rows);
  // Before the first view, the snapshot is acknowledged but not presented as news.
  return {
    mark: mark ? { at: mark.at } : null,
    events: mark ? events : [],
    snapshotIds: events.map((r) => r.id),
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
    .select({ id: activityEvents.id })
    .from(activityEvents)
    // diveday:allow-staff-events: A staff acknowledgment locks only the submitted shop-scoped event ids before recording the staff read mark.

    .innerJoin(trips, eq(trips.id, activityEvents.tripId))
    .where(
      and(
        inArray(activityEvents.id, eventIds),
        eq(activityEvents.shopId, input.shopId),
        // Only a desk line is acknowledged: a client-sent id is never a mark
        // on the rest of the trail.
        deskLine(),
        eq(trips.shopId, input.shopId),
        liveTrip(),
        gte(trips.startsAt, day.from),
        lt(trips.startsAt, day.to),
        gte(activityEvents.occurredAt, day.from),
      ),
    )
    .orderBy(activityEvents.id)
    .for("key share", { of: activityEvents });
  if (rows.length)
    await db
      .insert(todayReadMarkEvents)
      .values(rows.map(({ id }) => ({ shopId: input.shopId, markId, eventId: id })))
      .onConflictDoNothing();
}
