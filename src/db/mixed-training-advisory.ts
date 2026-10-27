import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { courseRatioKind } from "@/lib/course-ratios";
import { groupCrewAssignments, inWaterCrewRole } from "@/lib/crew-roles";
import { mixedTrainingCandidates, type TrainingSession } from "@/lib/mixed-training-advisory";
import type { AppDb } from "./client";
import {
  bookings,
  courses,
  people,
  personRoles,
  tripAssignments,
  tripScheduleDays,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";
import { seatHeld } from "./trips-queries";

/** A possible overlap, not evidence that these students are on the same boat or in one group. */
export async function mixedTrainingAdvisories(db: AppDb, shopId: string, tripId: string) {
  const [target] = await db
    .select({ trip: trips, course: courses })
    .from(trips)
    .innerJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, shopId)))
    .where(
      and(
        eq(trips.id, tripId),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        eq(trips.isRehearsal, false),
        liveTrip(),
      ),
    )
    .limit(1);
  if (!target || !courseRatioKind(target.course)) return [];
  const sessions = await db
    .select({ trip: trips, course: courses })
    .from(trips)
    .innerJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, shopId)))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        eq(trips.isRehearsal, false),
        liveTrip(),
        lt(trips.startsAt, target.trip.endsAt),
        gt(trips.endsAt, target.trip.startsAt),
      ),
    );
  const ids = sessions.map(({ trip }) => trip.id);
  if (ids.length < 2) return [];
  const [days, assignments, enrolled] = await Promise.all([
    db.select().from(tripScheduleDays).where(inArray(tripScheduleDays.tripId, ids)),
    // A pending or self-assigned instructor can still be part of a possible
    // overlap. This is broader than the trusted crew a training mark needs;
    // the advisory does not establish an instructor group or clearance.
    db
      .select({
        tripId: tripAssignments.tripId,
        personId: tripAssignments.personId,
        tripRole: tripAssignments.tripRole,
        role: personRoles.role,
      })
      .from(tripAssignments)
      .innerJoin(people, and(eq(people.id, tripAssignments.personId), eq(people.shopId, shopId)))
      .leftJoin(personRoles, eq(personRoles.personId, people.id))
      .where(inArray(tripAssignments.tripId, ids)),
    db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, shopId),
          inArray(bookings.tripId, ids),
          eq(bookings.participantType, "diver"),
          seatHeld,
        ),
      ),
  ]);
  const prepared = sessions.map(({ trip, course }): TrainingSession => {
    const meetingDays = days.filter((day) => day.tripId === trip.id);
    const crew = groupCrewAssignments(assignments.filter((row) => row.tripId === trip.id));
    return {
      id: trip.id,
      course,
      windows: meetingDays.length
        ? meetingDays
        : [{ startsAt: trip.startsAt, endsAt: trip.endsAt }],
      instructorIds: crew
        .filter((member) => inWaterCrewRole(member) === "instructor")
        .map((member) => member.personId),
      students: enrolled.filter((seat) => seat.tripId === trip.id).length,
    };
  });
  const source = prepared.find((session) => session.id === tripId);
  if (!source) return [];
  const matching = new Set(mixedTrainingCandidates(source, prepared));
  return sessions
    .filter(({ trip }) => matching.has(trip.id))
    .map(({ trip }) => {
      const other = prepared.find((session) => session.id === trip.id);
      const overlapping = source.windows
        .flatMap((a) =>
          (other?.windows ?? []).flatMap((b) =>
            a.startsAt < b.endsAt && b.startsAt < a.endsAt
              ? [new Date(Math.max(a.startsAt.getTime(), b.startsAt.getTime()))]
              : [],
          ),
        )
        .sort((a, b) => a.getTime() - b.getTime());
      return { tripId: trip.id, title: trip.title, startsAt: overlapping[0] ?? trip.startsAt };
    });
}
