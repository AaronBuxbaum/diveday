import { and, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import {
  bookings as bookingsTable,
  people,
  personRoles,
  tripDeskEvents,
  tripReadMarks,
  trips,
} from "./schema";
import { at } from "./seed-clock";

/**
 * **The morning handoff on today's reef boat** (issues #1202 and #1187, delight
 * report D42 with D27 folded in), plus the two divers who said the crew may
 * know it is their first trip (issue #1182, D22).
 *
 * Both are otherwise written only by something a *visitor* does — a check-in at
 * the counter, a walk-in seated, a diver tapping *Tell them* on their own
 * readiness link — so every seeded shop opened its manifest on a departure
 * nothing had ever happened to, and neither the strip nor the welcome word had
 * anything to be about.
 *
 * **What the demo shows, and what it cannot.** The owner's login (Dana Reyes)
 * is the reader: she carries a read mark stamped early this morning, and the
 * desk's acts after it are written by the lead instructor, so opening the
 * manifest shows the strip with something to say. The welcome cues are all
 * `first_trip`: the demo shop's history is a trailing quarter, so a two-year
 * gap cannot exist in it and the `returning` cue has no honest way to appear
 * here. Its words are pinned by `welcome-cue-labels.test.ts` instead.
 *
 * Annotation only. Nothing here is read by readiness, the head count, or the
 * Today queue's counts — the one row it adds to Today is the courtesy
 * `say_hello` line, which sits below every piece of work.
 */

/** What the desk did after the owner last looked, in the order it happened. */
const DESK_PLANS: {
  kind: (typeof tripDeskEvents.kind.enumValues)[number];
  rosterIndex: number | null;
  hour: number;
  minute: number;
}[] = [
  { kind: "arrival", rosterIndex: 0, hour: 6, minute: 22 },
  { kind: "arrival", rosterIndex: 1, hour: 6, minute: 28 },
  { kind: "seat_taken", rosterIndex: 5, hour: 6, minute: 35 },
  { kind: "help_request", rosterIndex: 3, hour: 6, minute: 41 },
  { kind: "meeting_point", rosterIndex: null, hour: 6, minute: 47 },
];

/** When the reader last looked — the canvas's own "Since you looked at 6:10". */
const READ_MARK_HOUR = 6;
const READ_MARK_MINUTE = 10;

/** How many consented first-trip cues to leave on the boat. */
const WELCOME_CUE_SEATS = 2;

export async function seedDeskHandoff(
  db: DbExecutor,
  shopId: string,
  ctx: {
    /** Today's headline departure — the first trip the trips scenario seeded. */
    trip: typeof trips.$inferSelect;
    /** Its roster, in the order the trip scenario booked it. */
    roster: (typeof bookingsTable.$inferSelect)[];
    /** The desk staffer whose acts these are. Never the reader below. */
    actorPersonId: string;
  },
): Promise<void> {
  const tripRoster = ctx.roster.filter((booking) => booking.tripId === ctx.trip.id);
  if (tripRoster.length === 0) return;

  // The reader is looked up by role rather than passed in, for the same reason
  // `seedDeskTrail` looks its actor up: a minted demo shop and the canonical
  // one give their staff different rows, and the strip is only visible to
  // somebody who has a mark.
  const [reader] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "owner"), isNull(people.deletedAt)))
    .limit(1);
  if (!reader || reader.id === ctx.actorPersonId) return;

  const eventRows = DESK_PLANS.flatMap((plan) => {
    const booking = plan.rosterIndex === null ? null : tripRoster[plan.rosterIndex];
    if (plan.rosterIndex !== null && !booking) return [];
    return [
      {
        shopId,
        tripId: ctx.trip.id,
        kind: plan.kind,
        bookingId: booking?.id ?? null,
        subjectPersonId: booking?.personId ?? null,
        actorPersonId: ctx.actorPersonId,
        occurredAt: at(0, plan.hour, plan.minute),
      },
    ];
  });
  if (eventRows.length === 0) return;
  await db.insert(tripDeskEvents).values(eventRows);

  // `last_seen_seq: 0` rather than a real sequence: every event above is on a
  // freshly seeded trip, so nothing precedes them and zero means "behind all of
  // them". The stamp is what the strip's label reads, and it is the one thing
  // here that has to be a wall-clock time in the shop's own zone.
  await db
    .insert(tripReadMarks)
    .values({
      shopId,
      tripId: ctx.trip.id,
      personId: reader.id,
      lastSeenSeq: 0,
      lastSeenAt: at(0, READ_MARK_HOUR, READ_MARK_MINUTE),
    })
    .onConflictDoNothing();

  // The welcome word (issue #1182). Which seats get it is *derived* rather than
  // listed: a diver whose only prior booking is one of the trailing quarter's
  // would read as a return after zero years, which renders nothing — so the
  // seed asks who has genuinely never been on one of this shop's boats and
  // stamps the first couple of those.
  const priorPersonIds = new Set(
    (
      await db
        .selectDistinct({ personId: bookingsTable.personId })
        .from(bookingsTable)
        .innerJoin(trips, eq(trips.id, bookingsTable.tripId))
        .where(
          and(
            eq(bookingsTable.shopId, shopId),
            ne(bookingsTable.tripId, ctx.trip.id),
            ne(bookingsTable.status, "cancelled"),
            lt(trips.startsAt, nowDate()),
          ),
        )
    ).map((row) => row.personId),
  );
  const firstTimerBookingIds = tripRoster
    .filter((booking) => !priorPersonIds.has(booking.personId))
    .slice(0, WELCOME_CUE_SEATS)
    .map((booking) => booking.id);
  if (firstTimerBookingIds.length > 0) {
    await db
      .update(bookingsTable)
      .set({ welcomeSharedAt: at(-1, 19, 40) })
      .where(
        and(eq(bookingsTable.shopId, shopId), inArray(bookingsTable.id, firstTimerBookingIds)),
      );
  }
}
