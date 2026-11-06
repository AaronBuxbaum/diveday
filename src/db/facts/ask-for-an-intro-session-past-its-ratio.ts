import { and, count, eq, gt, gte, isNull, lt, ne } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { requestCrewAssignment } from "@/db/crew-requests";
import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import { bookings, people, personRoles, tripAssignments, trips } from "@/db/schema";
import { seatDiver } from "@/db/seat-diver";
import { seatNotCancelled } from "@/db/trips";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { courseRatioCapacity, INTRO_COURSE_RATIO } from "@/lib/course-ratios";

/**
 * **An intro session past its ratio, with a divemaster asking to work it**
 * (issue #1676, the second half of #1339). The Discover Scuba session is
 * crewed by one instructor and booked one past what one instructor may take
 * on an intro dive; the demo divemaster has asked for it.
 *
 * A divemaster aboard adds no seats there — the intro cap is instructor-to-
 * student (`INTRO_COURSE_RATIO`, no assistant bonus) — which is what the
 * sentence beside Approve, the approval's own notice and the asker's own line
 * on the staffing week each say. Nothing else reaches all three at once.
 *
 * Reached through the real doors where one exists: both instructors are put
 * on the session first so the booking transaction's ratio admits the seats
 * (`seatDiver` would refuse a fourth student to one instructor, rightly), and
 * the ask is `requestCrewAssignment`. Then the second instructor comes
 * straight off the assignment rows, as `unstaffTomorrowsDeparture` does:
 * `setTripCrew` refuses to leave a course session short of its ratio, and
 * that is precisely the state being walked.
 */
const INTRO_SESSION_TITLE = "Discover Scuba — Pool & Reef";

export async function askForAnIntroSessionPastItsRatio(
  db: AppDb,
  shopId: string,
  actorPersonId: string,
  now: Date,
  timezone: string,
): Promise<{ tripId: string; title: string; asker: string; date: string } | null> {
  const [session] = await db
    .select({ id: trips.id, title: trips.title, startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.title, INTRO_SESSION_TITLE),
        eq(trips.status, "scheduled"),
        isNull(trips.deletedAt),
        gte(trips.startsAt, now),
      ),
    )
    .orderBy(trips.startsAt)
    .limit(1);
  if (!session) return null;

  const instructors = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(people.id, personRoles.personId))
    .where(
      and(eq(people.shopId, shopId), eq(personRoles.role, "instructor"), isNull(people.deletedAt)),
    )
    .orderBy(people.fullName);
  const [asker] = await db
    .select({ id: people.id, fullName: people.fullName })
    .from(people) // diveday:allow-deleted-people: an e2e seed finds the people it just seeded
    .where(and(eq(people.shopId, shopId), eq(people.email, DEV_STAFF_LOGINS.divemaster.email)))
    .limit(1);
  const [kept, relief] = instructors;
  if (!kept || !relief || !asker) return null;

  await db.delete(tripAssignments).where(eq(tripAssignments.tripId, session.id));
  await db.insert(tripAssignments).values([
    { tripId: session.id, personId: kept.id },
    { tripId: session.id, personId: relief.id },
  ]);

  // One past what a single instructor may take on an intro dive.
  const pastTheCap = courseRatioCapacity(INTRO_COURSE_RATIO, 1, 0) + 1;
  const [{ booked }] = await db
    .select({ booked: count(bookings.id) })
    .from(bookings)
    .where(and(eq(bookings.tripId, session.id), seatNotCancelled));
  for (let seat = booked; seat < pastTheCap; seat += 1) {
    const seated = await seatDiver(db, {
      shopId,
      tripId: session.id,
      actorPersonId,
      diver: { fullName: `Intro Guest ${seat + 1}` },
      entry: "roster",
      refusals: "coarse",
    });
    if (!seated.ok) return null;
  }

  await db
    .delete(tripAssignments)
    .where(and(eq(tripAssignments.tripId, session.id), eq(tripAssignments.personId, relief.id)));

  // The asker is free those hours. The demo has the divemaster offshore on the
  // long-range day that overlaps this session, so approving would have been
  // refused as a crew clash — the ordinary "assignment was refused" notice,
  // not the state being walked. Off that boat, straight off the rows.
  const overlapping = await db
    .select({ tripId: tripAssignments.tripId })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .where(
      and(
        eq(tripAssignments.personId, asker.id),
        ne(trips.id, session.id),
        lt(trips.startsAt, session.endsAt),
        gt(trips.endsAt, session.startsAt),
      ),
    );
  for (const row of overlapping) {
    await db
      .delete(tripAssignments)
      .where(and(eq(tripAssignments.tripId, row.tripId), eq(tripAssignments.personId, asker.id)));
  }

  const asked = await requestCrewAssignment(db, {
    shopId,
    tripId: session.id,
    personId: asker.id,
    actorPersonId: asker.id,
    now,
  });
  if (!asked.ok) return null;
  // The session's own shop-local day, so a spec opens the staffing week it
  // sits in (`?week=` takes any date of a week) rather than hoping it is this one.
  return {
    tripId: session.id,
    title: session.title,
    asker: asker.fullName,
    date: calendarDateInTimezone(session.startsAt, timezone),
  };
}
