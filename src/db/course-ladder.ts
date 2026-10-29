import {
  and,
  asc,
  count,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
} from "drizzle-orm";
import { sellableSeats } from "@/lib/boat-safety";
import { type CalendarDate, calendarDateInTimezone } from "@/lib/calendar-date";
import type { CertificationLevel } from "@/lib/certification-levels";
import { courseLadderSince, ladderExclusion, nextCourseFor } from "@/lib/course-ladder";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import type { DbExecutor } from "./client";
import { listCatalogInProgressionOrder } from "./courses";
import { physicianReferrals, recentlyInvitedPeople } from "./invite-suggestions";
import { queryAll } from "./query-helpers";
import { bookings, certifications, courses, people, trips } from "./schema";
import { livePerson, liveTrip, notRehearsal } from "./trips-live";
import {
  liveBookingJoin,
  tripAssignedCrewCount,
  tripBoatCapacity,
  tripBoatCertifiedPassengers,
} from "./trips-queries";

/** One person who finished a course here and has not booked its next step. */
export type LadderPerson = {
  personId: string;
  fullName: string;
  /** Has an address, has not opted out, and was not invited inside the cooldown. */
  invitable: boolean;
  /**
   * Their release is parked on a physician's referral, uncleared (dive-domain
   * review N4): the desk calls rather than emails a course invite.
   */
  medicalReferral: boolean;
};

export type LadderStep = {
  course: { id: string; title: string };
  next: { id: string; title: string };
  /**
   * `taster`: did the taster in the window, `count` of them, `wentOn` booked
   * the next course. `certified`: carded here in the window, `count` of them,
   * `wentOn` booked the next course.
   */
  kind: "taster" | "certified";
  count: number;
  wentOn: number;
  /** Those who have not booked the next step, by name. */
  stalled: LadderPerson[];
  /** The next course's soonest public session with a seat, if there is one. */
  nextSession: { tripId: string; startsAt: Date; booked: number; capacity: number } | null;
};

/**
 * **The course ladder for the Courses page** (fifth-loop ideas, item 45): for
 * each course with a next step and anyone in the last twelve months, how many
 * finished it here and how many went on, the names of those who did not, and
 * the next session to ask them to.
 *
 * A taster's cohort is everyone with a seat on a sailed session of it; a
 * certification's is every live card the shop issued from one of its
 * sessions. "Went on" is any seat held on any session of the next course.
 * Erased and merged people are left out; rehearsals count for nothing.
 *
 * The names never include anyone the next course is wrong for
 * (`ladderExclusion`, dive-domain review F3): a card at or above the level it
 * certifies, from any agency and in any state, or younger than its minimum
 * age on the next session's day (today's, with no session).
 */
export async function getCourseLadder(
  db: DbExecutor,
  shopId: string,
  now: Date,
  timeZone: string,
): Promise<LadderStep[]> {
  const catalog = await listCatalogInProgressionOrder(db, shopId);
  const pairs = catalog.flatMap((course) => {
    const next = nextCourseFor(course, catalog);
    return next ? [{ course, next }] : [];
  });
  if (pairs.length === 0) return [];
  const since = courseLadderSince(now);
  const sailedBefore = new Date(now.getTime() - DEPARTURE_BUFFER_MS);

  const steps = await queryAll(
    db,
    pairs.map(({ course, next }) => async () => {
      const cohort = course.isIntroCourse
        ? await db
            .selectDistinct({ personId: people.id, fullName: people.fullName })
            .from(bookings)
            .innerJoin(trips, eq(trips.id, bookings.tripId))
            .innerJoin(people, eq(people.id, bookings.personId))
            .where(
              and(
                eq(bookings.shopId, shopId),
                eq(trips.shopId, shopId),
                eq(trips.courseId, course.id),
                gte(trips.startsAt, since),
                lt(trips.startsAt, sailedBefore),
                liveTrip(),
                notRehearsal(),
                notInArray(bookings.status, ["cancelled", "no_show"]),
                livePerson(),
                isNull(people.mergedIntoPersonId),
              ),
            )
        : await db
            .selectDistinct({ personId: people.id, fullName: people.fullName })
            .from(certifications)
            .innerJoin(trips, eq(trips.id, certifications.issuedFromTripId))
            .innerJoin(people, eq(people.id, certifications.personId))
            .where(
              and(
                eq(certifications.shopId, shopId),
                eq(trips.shopId, shopId),
                eq(trips.courseId, course.id),
                isNull(certifications.deletedAt),
                isNotNull(certifications.issuedByShopAt),
                gte(certifications.issuedByShopAt, since),
                livePerson(),
                isNull(people.mergedIntoPersonId),
              ),
            );
      if (cohort.length === 0) return null;
      const ids = cohort.map((row) => row.personId);
      const wentOnRows = await db
        .selectDistinct({ personId: bookings.personId })
        .from(bookings)
        .innerJoin(trips, eq(trips.id, bookings.tripId))
        .where(
          and(
            eq(bookings.shopId, shopId),
            inArray(bookings.personId, ids),
            eq(trips.courseId, next.id),
            liveTrip(),
            notRehearsal(),
            notInArray(bookings.status, ["cancelled", "no_show"]),
          ),
        );
      const wentOn = new Set(wentOnRows.map((row) => row.personId));
      return { course, next, cohort, wentOn };
    }),
  );
  const live = steps.filter((step) => step !== null);
  if (live.length === 0) return [];

  const stalledIds = [
    ...new Set(
      live.flatMap((step) =>
        step.cohort.filter((row) => !step.wentOn.has(row.personId)).map((row) => row.personId),
      ),
    ),
  ];
  const [reachable, recent, sessions, facts, referred] = await queryAll(db, [
    async () =>
      stalledIds.length
        ? db
            .select({ id: people.id })
            .from(people)
            .where(
              and(
                eq(people.shopId, shopId),
                inArray(people.id, stalledIds),
                isNotNull(people.email),
                isNull(people.courtesyEmailOptOutAt),
                isNull(people.anonymizedAt),
                livePerson(),
              ),
            )
        : [],
    () => recentlyInvitedPeople(db, shopId, now),
    () =>
      nextSessionsFor(
        db,
        shopId,
        live.map((step) => step.next.id),
        now,
      ),
    () => ladderFacts(db, shopId, stalledIds),
    () => physicianReferrals(db, shopId, stalledIds),
  ]);
  const canReach = new Set(reachable.map((row) => row.id));
  const today = calendarDateInTimezone(now, timeZone);

  return live.map(({ course, next, cohort, wentOn }) => {
    const nextSession = sessions.get(next.id) ?? null;
    const onDate = nextSession ? calendarDateInTimezone(nextSession.startsAt, timeZone) : today;
    return {
      course: { id: course.id, title: course.title },
      next: { id: next.id, title: next.title },
      kind: course.isIntroCourse ? ("taster" as const) : ("certified" as const),
      count: cohort.length,
      wentOn: wentOn.size,
      stalled: cohort
        .filter((row) => !wentOn.has(row.personId))
        .filter((row) => ladderExclusion(next, factsFor(facts, row.personId), onDate) === null)
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .map((row) => ({
          personId: row.personId,
          fullName: row.fullName,
          invitable: canReach.has(row.personId) && !recent.has(row.personId),
          medicalReferral: referred.has(row.personId),
        })),
      nextSession,
    };
  });
}

type LadderFacts = Map<
  string,
  { heldLevels: CertificationLevel[]; dateOfBirth: CalendarDate | null }
>;

function factsFor(facts: LadderFacts, personId: string) {
  return facts.get(personId) ?? { heldLevels: [], dateOfBirth: null };
}

/** Every live level card (any agency, any state) and the date of birth of each person. */
async function ladderFacts(
  db: DbExecutor,
  shopId: string,
  personIds: string[],
): Promise<LadderFacts> {
  const facts: LadderFacts = new Map();
  if (personIds.length === 0) return facts;
  const [cards, births] = await queryAll(db, [
    () =>
      db
        .select({ personId: certifications.personId, level: certifications.level })
        .from(certifications)
        .where(
          and(
            eq(certifications.shopId, shopId),
            inArray(certifications.personId, personIds),
            isNull(certifications.deletedAt),
          ),
        ),
    () =>
      db
        .select({ id: people.id, dateOfBirth: people.dateOfBirth })
        .from(people)
        .where(and(eq(people.shopId, shopId), inArray(people.id, personIds), livePerson())),
  ]);
  for (const row of births) facts.set(row.id, { heldLevels: [], dateOfBirth: row.dateOfBirth });
  for (const card of cards) {
    const entry = facts.get(card.personId) ?? { heldLevels: [], dateOfBirth: null };
    entry.heldLevels.push(card.level);
    facts.set(card.personId, entry);
  }
  return facts;
}

/**
 * The ladder's own refusal for one invite, re-run by the action for a page
 * left open (dive-domain review F3, security review N3): the trip must be a
 * live session of a course, and the person must not already hold that
 * course's card or be under its minimum age on the session's day. `null`
 * when they may be asked. The departure's own gate (public, scheduled, a
 * seat, the course prerequisite) is `departureOpenToDiver`, under the
 * cooldown lock.
 */
export async function ladderInviteRefusal(
  db: DbExecutor,
  input: { shopId: string; personId: string; tripId: string; timeZone: string },
): Promise<"not_a_course_session" | "holds_next" | "under_age" | null> {
  const [session] = await db
    .select({
      startsAt: trips.startsAt,
      certifiesLevel: courses.certifiesLevel,
      minimumAge: courses.minimumAge,
    })
    .from(trips)
    .innerJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, input.shopId)))
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!session) return "not_a_course_session";
  const facts = await ladderFacts(db, input.shopId, [input.personId]);
  return ladderExclusion(
    session,
    factsFor(facts, input.personId),
    calendarDateInTimezone(session.startsAt, input.timeZone),
  );
}

/** Each course's soonest public, scheduled session that still has a seat. */
async function nextSessionsFor(
  db: DbExecutor,
  shopId: string,
  courseIds: string[],
  now: Date,
): Promise<Map<string, NonNullable<LadderStep["nextSession"]>>> {
  const rows = await db
    .select({
      tripId: trips.id,
      courseId: trips.courseId,
      startsAt: trips.startsAt,
      capacity: trips.capacity,
      certifiedPassengers: tripBoatCertifiedPassengers(),
      boatCapacity: tripBoatCapacity(),
      assignedCrewCount: tripAssignedCrewCount(),
      booked: count(bookings.id),
    })
    .from(trips)
    .leftJoin(bookings, liveBookingJoin)
    .where(
      and(
        eq(trips.shopId, shopId),
        inArray(trips.courseId, courseIds),
        liveTrip(),
        notRehearsal(),
        eq(trips.status, "scheduled"),
        eq(trips.isPrivate, false),
        gt(trips.startsAt, now),
      ),
    )
    .groupBy(trips.id)
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));
  const soonest = new Map<string, NonNullable<LadderStep["nextSession"]>>();
  for (const row of rows) {
    if (!row.courseId || soonest.has(row.courseId)) continue;
    const capacity = sellableSeats(
      row.capacity,
      row.certifiedPassengers,
      row.boatCapacity,
      row.assignedCrewCount,
    );
    if (row.booked >= capacity) continue;
    soonest.set(row.courseId, {
      tripId: row.tripId,
      startsAt: row.startsAt,
      booked: row.booked,
      capacity,
    });
  }
  return soonest;
}
