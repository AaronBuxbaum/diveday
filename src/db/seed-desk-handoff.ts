import { and, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { tripArrivalSnapshot } from "@/lib/trip-change-events";
import type { DbExecutor } from "./client";
import { recordDeskEvent } from "./desk-events";
import { getBookingReadiness } from "./readiness";
import {
  activityEvents,
  bookingArrivalEvents,
  bookings as bookingsTable,
  people,
  personRoles,
  tripHelpRequests,
  tripReadMarks,
  trips,
} from "./schema";
import { at } from "./seed-clock";
import { recordTripChangeEvent } from "./trip-change-events";

/**
 * **The morning handoff on today's reef boat** (issues #1202 and #1187,
 * delight report D42 with D27 folded in), plus the two divers who said the crew
 * may know it is their first trip (issue #1182, D22).
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
 * **Every line the strip says is true of the rows under it** (UX review
 * 2026-10-13, item 3). The strip used to be written as annotation alone, so
 * the demo's manifest said "Priya Sharma and Tom Okafor have checked in."
 * directly above "0 of 11 people aboard" and Priya's row reading Blocked, and
 * "The meeting point moved." on a departure with no meeting point. Each act
 * here now writes what the real act writes: a check-in the seat, its arrival
 * trail and its activity line, and only for a seat readiness would let the
 * counter check in; the ask for a hand its `trip_help_requests` row; the moved
 * meeting point the departure's own columns and the diver-facing change
 * ledger. The strip's reader (`listDeskEventsSince`) also drops a roster line
 * the roster no longer bears out, so the two cannot drift apart afterwards.
 *
 * Runs after every scenario that can block a diver on this boat, so the
 * readiness each check-in asks for is the readiness the roster will show.
 */

/** What the desk did after the owner last looked, in the order it happened. */
const DESK_PLANS: {
  kind: "arrival" | "seat_taken" | "help_request" | "meeting_point";
  rosterIndex: number | null;
  hour: number;
  minute: number;
}[] = [
  // Tom Okafor and June Park: two cleared divers no spec walks through the
  // counter itself (Priya, Diego and Lena are each a spec's own check-in).
  { kind: "arrival", rosterIndex: 1, hour: 6, minute: 22 },
  { kind: "arrival", rosterIndex: 4, hour: 6, minute: 28 },
  { kind: "seat_taken", rosterIndex: 5, hour: 6, minute: 35 },
  { kind: "help_request", rosterIndex: 3, hour: 6, minute: 41 },
  { kind: "meeting_point", rosterIndex: null, hour: 6, minute: 47 },
];

/**
 * Where the boat meets this morning: the shop's own marina, a different slip.
 * A label alone, so the address and the map stay the shop's own
 * (`meetingPointOf`).
 */
const DEMO_MEETING_POINT_LABEL = "Slip 4, the east dock";

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

  for (const plan of DESK_PLANS) {
    const occurredAt = at(0, plan.hour, plan.minute);
    if (plan.kind === "meeting_point") {
      await moveMeetingPoint(db, shopId, ctx.trip, ctx.actorPersonId, occurredAt);
      continue;
    }
    const booking = plan.rosterIndex === null ? undefined : tripRoster[plan.rosterIndex];
    if (!booking) continue;
    if (plan.kind === "arrival") {
      await checkIn(db, shopId, booking, ctx.actorPersonId, occurredAt);
      continue;
    }
    if (plan.kind === "help_request") {
      // The diver's own ask on their link: no staff actor, so it is news to
      // every staffer including the desk (`saveHelpRequest`).
      await db.insert(tripHelpRequests).values({
        shopId,
        tripId: ctx.trip.id,
        bookingId: booking.id,
        kind: "carry_gear",
        status: "requested",
        createdAt: occurredAt,
        updatedAt: occurredAt,
      });
      await recordDeskEvent(db, {
        shopId,
        tripId: ctx.trip.id,
        kind: "help_request",
        bookingId: booking.id,
        subjectPersonId: booking.personId,
        occurredAt,
      });
      continue;
    }
    await recordDeskEvent(db, {
      shopId,
      tripId: ctx.trip.id,
      kind: plan.kind,
      bookingId: booking.id,
      subjectPersonId: booking.personId,
      actorPersonId: ctx.actorPersonId,
      occurredAt,
    });
  }

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

/**
 * A counter check-in, written the way `checkInBooking` writes one: the seat's
 * status, the arrival trail under it, the activity line and the crew's
 * catch-up line. Only for a seat readiness clears, which is the counter's own
 * refusal; a seat it would refuse is left booked and says nothing.
 *
 * Written directly rather than through `checkInBooking`, which takes the
 * app's pool for its transaction while the seed runs on a plain executor (the
 * same reason `seed-course-inquiries.ts` gives).
 */
async function checkIn(
  db: DbExecutor,
  shopId: string,
  booking: typeof bookingsTable.$inferSelect,
  actorPersonId: string,
  occurredAt: Date,
): Promise<void> {
  if (booking.status !== "booked") return;
  const readiness = await getBookingReadiness(db, shopId, booking.id);
  if (readiness?.status !== "ready") return;
  const [diver] = await db
    .select({ fullName: people.fullName })
    .from(people)
    .where(eq(people.id, booking.personId))
    .limit(1);
  if (!diver) return;
  await db
    .update(bookingsTable)
    .set({ status: "checked_in", runningLateAt: null })
    .where(and(eq(bookingsTable.id, booking.id), eq(bookingsTable.shopId, shopId)));
  await db.insert(bookingArrivalEvents).values({
    shopId,
    tripId: booking.tripId,
    bookingId: booking.id,
    recordedByPersonId: actorPersonId,
    status: "arrived",
    occurredAt,
  });
  await db.insert(activityEvents).values({
    shopId,
    tripId: booking.tripId,
    bookingId: booking.id,
    actorPersonId,
    code: "counter_check_in",
    params: { diver: diver.fullName },
    occurredAt,
  });
  await recordDeskEvent(db, {
    shopId,
    tripId: booking.tripId,
    kind: "arrival",
    bookingId: booking.id,
    subjectPersonId: booking.personId,
    actorPersonId,
    occurredAt,
  });
}

/**
 * The meeting point moved, written the way a Details save writes it
 * (`updateTrip`): the departure's own columns, the diver-facing change ledger
 * and the crew's catch-up line, so `/ready`, every message and the manifest
 * agree about where the boat is.
 */
async function moveMeetingPoint(
  db: DbExecutor,
  shopId: string,
  trip: typeof trips.$inferSelect,
  actorPersonId: string,
  occurredAt: Date,
): Promise<void> {
  const [moved] = await db
    .update(trips)
    .set({ meetingPointLabel: DEMO_MEETING_POINT_LABEL })
    .where(and(eq(trips.id, trip.id), eq(trips.shopId, shopId)))
    .returning();
  if (!moved) return;
  await recordTripChangeEvent(db, {
    shopId,
    tripId: trip.id,
    kind: "meeting_point",
    source: "shop",
    beforeValue: tripArrivalSnapshot(trip),
    afterValue: tripArrivalSnapshot(moved),
    actorPersonId,
    occurredAt,
  });
  await recordDeskEvent(db, {
    shopId,
    tripId: trip.id,
    kind: "meeting_point",
    actorPersonId,
    occurredAt,
  });
}
