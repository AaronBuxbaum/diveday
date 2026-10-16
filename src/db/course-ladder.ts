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
import { courseLadderSince, nextCourseFor } from "@/lib/course-ladder";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import type { DbExecutor } from "./client";
import { listCatalogInProgressionOrder } from "./courses";
import { recentlyInvitedPeople } from "./invite-suggestions";
import { bookings, certifications, people, trips } from "./schema";
import { livePerson, liveTrip, notRehearsal } from "./trips-live";
import { liveBookingJoin, tripBoatCertifiedPassengers } from "./trips-queries";

/** One person who finished a course here and has not booked its next step. */
export type LadderPerson = {
  personId: string;
  fullName: string;
  /** Has an address, has not opted out, and was not invited inside the cooldown. */
  invitable: boolean;
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
 */
export async function getCourseLadder(
  db: DbExecutor,
  shopId: string,
  now: Date,
): Promise<LadderStep[]> {
  const catalog = await listCatalogInProgressionOrder(db, shopId);
  const pairs = catalog.flatMap((course) => {
    const next = nextCourseFor(course, catalog);
    return next ? [{ course, next }] : [];
  });
  if (pairs.length === 0) return [];
  const since = courseLadderSince(now);
  const sailedBefore = new Date(now.getTime() - DEPARTURE_BUFFER_MS);

  const steps = await Promise.all(
    pairs.map(async ({ course, next }) => {
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
  const [reachable, recent, sessions] = await Promise.all([
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
            ),
          )
      : [],
    recentlyInvitedPeople(db, shopId, now),
    nextSessionsFor(
      db,
      shopId,
      live.map((step) => step.next.id),
      now,
    ),
  ]);
  const canReach = new Set(reachable.map((row) => row.id));

  return live.map(({ course, next, cohort, wentOn }) => ({
    course: { id: course.id, title: course.title },
    next: { id: next.id, title: next.title },
    kind: course.isIntroCourse ? ("taster" as const) : ("certified" as const),
    count: cohort.length,
    wentOn: wentOn.size,
    stalled: cohort
      .filter((row) => !wentOn.has(row.personId))
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map((row) => ({
        personId: row.personId,
        fullName: row.fullName,
        invitable: canReach.has(row.personId) && !recent.has(row.personId),
      })),
    nextSession: sessions.get(next.id) ?? null,
  }));
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
    .orderBy(asc(trips.startsAt), asc(trips.id));
  const soonest = new Map<string, NonNullable<LadderStep["nextSession"]>>();
  for (const row of rows) {
    if (!row.courseId || soonest.has(row.courseId)) continue;
    const capacity = sellableSeats(row.capacity, row.certifiedPassengers);
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
