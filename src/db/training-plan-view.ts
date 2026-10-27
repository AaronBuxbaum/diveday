import { and, asc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { inWaterCrewRole } from "@/lib/crew-roles";
import type { ParticipantType } from "@/lib/participant-types";
import { trainingAllocationPlan } from "@/lib/training-allocation-plan";
import { courseInstructorIdsAboard, trainingMarkProblem } from "@/lib/training-mark";
import type { DbExecutor } from "./client";
import { bookings, people, trips } from "./schema";
import { ratioRuleOf, readTrainingEnrollments, trustedCrewOfTrips } from "./training-mark-resolve";
import { readTrainingPlan } from "./training-plans";
import { livePerson, liveTrip } from "./trips-live";

/** A planning view only; it never changes the safety decision for a seat. */
export async function trainingPlanView(db: DbExecutor, shopId: string, tripId: string) {
  const rows = await db
    .select({
      id: bookings.id,
      personId: bookings.personId,
      name: people.fullName,
      enrollmentId: bookings.trainingEnrollmentBookingId,
      participantType: bookings.participantType,
      startsAt: trips.startsAt,
      courseId: trips.courseId,
      instructorPersonId: bookings.trainingPlanInstructorPersonId,
      identityHeld: bookings.identityUnconfirmedAt,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(trips.shopId, shopId),
        eq(people.shopId, shopId),
        eq(trips.id, tripId),
        liveTrip(),
        livePerson(),
        isNull(people.anonymizedAt),
        isNotNull(bookings.trainingEnrollmentBookingId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(people.fullName), asc(bookings.id));
  if (!rows.length) return null;
  const enrollments = await readTrainingEnrollments(
    db,
    shopId,
    rows.flatMap((r) => (r.enrollmentId ? [r.enrollmentId] : [])),
  );
  const crewByTrip = await trustedCrewOfTrips(db, shopId, [
    tripId,
    ...Array.from(enrollments.values(), (e) => e.tripId),
  ]);
  const rosteredCrew = crewByTrip.get(tripId) ?? [];
  const ids = rosteredCrew.map((c) => c.personId);
  const names = ids.length
    ? await db
        .select({ id: people.id, name: people.fullName })
        .from(people)
        .where(
          and(
            eq(people.shopId, shopId),
            livePerson(),
            isNull(people.anonymizedAt),
            inArray(people.id, ids),
          ),
        )
    : [];
  const nameById = new Map(names.map((n) => [n.id, n.name]));
  const departureCrew = rosteredCrew.filter((c) => nameById.has(c.personId));
  const instructors = departureCrew
    .filter((c) => inWaterCrewRole(c) === "instructor" && nameById.has(c.personId))
    .map((c) => ({ id: c.personId, name: nameById.get(c.personId) ?? "" }));
  const saved = await readTrainingPlan(db, shopId, tripId);
  const assistantPlan = new Map(
    saved.assistants.map((a) => [a.assistantPersonId, a.instructorPersonId]),
  );
  const assistants = departureCrew
    .filter((c) => inWaterCrewRole(c) === "certified_assistant" && nameById.has(c.personId))
    .map((c) => ({
      id: c.personId,
      name: nameById.get(c.personId) ?? "",
      instructorPersonId: assistantPlan.get(c.personId) ?? null,
    }));
  const students = rows.map((r) => {
    const enrollment = r.enrollmentId ? (enrollments.get(r.enrollmentId) ?? null) : null;
    const valid =
      !r.identityHeld &&
      !trainingMarkProblem(
        {
          personId: r.personId,
          participantType: r.participantType as ParticipantType,
          onCourseSession: r.courseId !== null,
          departureStartsAt: r.startsAt,
        },
        enrollment,
      );
    const sessionTripId = enrollment?.tripId ?? "";
    const eligible = valid
      ? courseInstructorIdsAboard(crewByTrip.get(sessionTripId) ?? [], departureCrew)
      : [];
    return {
      id: r.id,
      name: r.name,
      sessionTripId,
      instructorPersonId: r.instructorPersonId,
      rule: valid && enrollment ? ratioRuleOf(enrollment.course) : null,
      eligible,
    };
  });
  const allocation = trainingAllocationPlan({
    students,
    sessionCrew: crewByTrip,
    departureCrew,
    assistants: assistants.map((a) => ({
      assistantPersonId: a.id,
      instructorPersonId: a.instructorPersonId,
    })),
  });
  return { instructors, assistants, students, allocation };
}
