import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { canConfigureTrips } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { groupCrewAssignments, inWaterCrewRole } from "@/lib/crew-roles";
import type { ParticipantType } from "@/lib/participant-types";
import { trainingMarkProblem } from "@/lib/training-mark";
import { hasReturned } from "@/lib/trips";
import { loadActiveStaffRoles } from "./authz";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import type { AppDb, DbExecutor } from "./client";
import { queryAll } from "./query-helpers";
import { bookings, people, personRoles, tripAssignments, trips } from "./schema";
import {
  readTrainingEnrollments,
  teachesSessionAsRostered,
  trustedCrewOfTrips,
} from "./training-mark-resolve";
import { livePerson, liveTrip } from "./trips-live";

type Subject = { kind: "assistant"; personId: string } | { kind: "student"; bookingId: string };

/** Staff planning only; these assignments never establish an actual in-water group. */
export async function setTrainingPlanAssignment(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    actorPersonId: string;
    subject: Subject;
    instructorPersonId: string | null;
  },
): Promise<{ ok: boolean }> {
  return db.transaction(async (tx) => {
    // The same shop lock as boarding evidence prevents an erasure/merge from
    // finishing its personal-data sweep before this plan is written.
    await lockBoardingCertificationEvidence(tx, input.shopId, "boarding");
    const roles = await loadActiveStaffRoles(tx, input.shopId, input.actorPersonId);
    if (!roles || !canConfigureTrips(roles)) return { ok: false };
    const [trip] = await tx
      .select({
        id: trips.id,
        status: trips.status,
        endsAt: trips.endsAt,
        startsAt: trips.startsAt,
        courseId: trips.courseId,
      })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1)
      .for("update");
    if (!trip || trip.status === "cancelled" || hasReturned(trip.endsAt, nowDate()))
      return { ok: false };
    if (input.instructorPersonId === null) {
      const cleared = {
        trainingPlanInstructorPersonId: null,
        trainingPlanByPersonId: null,
        trainingPlanAt: null,
      };
      if (input.subject.kind === "assistant") {
        await tx
          .update(tripAssignments)
          .set(cleared)
          .where(
            and(
              eq(tripAssignments.tripId, input.tripId),
              eq(tripAssignments.personId, input.subject.personId),
            ),
          );
      } else {
        await tx
          .update(bookings)
          .set(cleared)
          .where(
            and(
              eq(bookings.shopId, input.shopId),
              eq(bookings.tripId, input.tripId),
              eq(bookings.id, input.subject.bookingId),
            ),
          );
      }
      return { ok: true };
    }
    const rows = await tx
      .select({
        personId: tripAssignments.personId,
        tripRole: tripAssignments.tripRole,
        role: personRoles.role,
        assignedBy: tripAssignments.assignedByPersonId,
      })
      .from(tripAssignments)
      .innerJoin(people, eq(people.id, tripAssignments.personId))
      .leftJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        and(
          eq(tripAssignments.tripId, input.tripId),
          eq(people.shopId, input.shopId),
          livePerson(),
          isNull(people.anonymizedAt),
        ),
      );
    const crew = groupCrewAssignments(rows);
    const trusted = (personId: string) =>
      rows.some(
        (row) =>
          row.personId === personId && row.assignedBy !== null && row.assignedBy !== personId,
      );
    const teacher = crew.find((member) => member.personId === input.instructorPersonId);
    if (!teacher || !trusted(teacher.personId) || inWaterCrewRole(teacher) !== "instructor")
      return { ok: false };
    const departureCrew =
      (await trustedCrewOfTrips(tx, input.shopId, [input.tripId])).get(input.tripId) ?? [];
    if (
      !departureCrew.some(
        (member) =>
          member.personId === teacher.personId && inWaterCrewRole(member) === "instructor",
      )
    )
      return { ok: false };
    const updatedAt = nowDate();
    if (input.subject.kind === "assistant") {
      const assistantId = input.subject.personId;
      const assistant = crew.find((member) => member.personId === assistantId);
      if (
        !assistant ||
        !trusted(assistant.personId) ||
        !departureCrew.some(
          (member) =>
            member.personId === assistant.personId &&
            inWaterCrewRole(member) === "certified_assistant",
        ) ||
        inWaterCrewRole(assistant) !== "certified_assistant" ||
        assistant.personId === teacher.personId
      )
        return { ok: false };
      await tx
        .update(tripAssignments)
        .set({
          trainingPlanInstructorPersonId: teacher.personId,
          trainingPlanByPersonId: input.actorPersonId,
          trainingPlanAt: updatedAt,
        })
        .where(
          and(
            eq(tripAssignments.tripId, input.tripId),
            eq(tripAssignments.personId, assistant.personId),
          ),
        );
    } else {
      const [seat] = await tx
        .select({
          enrollmentId: bookings.trainingEnrollmentBookingId,
          status: bookings.status,
          personId: bookings.personId,
          participantType: bookings.participantType,
          identityUnconfirmedAt: bookings.identityUnconfirmedAt,
        })
        .from(bookings)
        .innerJoin(people, eq(people.id, bookings.personId))
        .where(
          and(
            eq(bookings.id, input.subject.bookingId),
            eq(bookings.tripId, input.tripId),
            eq(bookings.shopId, input.shopId),
            eq(people.shopId, input.shopId),
            livePerson(),
            isNull(people.anonymizedAt),
          ),
        )
        .limit(1)
        .for("update", { of: bookings });
      if (!seat || seat.status === "cancelled" || seat.identityUnconfirmedAt || !seat.enrollmentId)
        return { ok: false };
      const enrollment =
        (await readTrainingEnrollments(tx, input.shopId, [seat.enrollmentId])).get(
          seat.enrollmentId,
        ) ?? null;
      if (
        !enrollment ||
        trainingMarkProblem(
          {
            personId: seat.personId,
            participantType: seat.participantType as ParticipantType,
            onCourseSession: trip.courseId !== null,
            departureStartsAt: trip.startsAt,
          },
          enrollment,
        ) ||
        !(await teachesSessionAsRostered(tx, input.shopId, enrollment.tripId, teacher.personId))
      )
        return { ok: false };
      const sessionCrew =
        (await trustedCrewOfTrips(tx, input.shopId, [enrollment.tripId])).get(enrollment.tripId) ??
        [];
      if (
        !sessionCrew.some(
          (member) =>
            member.personId === teacher.personId && inWaterCrewRole(member) === "instructor",
        )
      )
        return { ok: false };
      await tx
        .update(bookings)
        .set({
          trainingPlanInstructorPersonId: teacher.personId,
          trainingPlanByPersonId: input.actorPersonId,
          trainingPlanAt: updatedAt,
        })
        .where(
          and(
            eq(bookings.shopId, input.shopId),
            eq(bookings.tripId, input.tripId),
            eq(bookings.id, input.subject.bookingId),
          ),
        );
    }
    return { ok: true };
  });
}

export async function readTrainingPlan(db: DbExecutor, shopId: string, tripId: string) {
  const [assistants, students] = await queryAll(db, [
    () =>
      db
        .select({
          assistantPersonId: tripAssignments.personId,
          instructorPersonId: tripAssignments.trainingPlanInstructorPersonId,
        })
        .from(tripAssignments)
        .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
        .where(
          and(
            eq(trips.shopId, shopId),
            eq(trips.id, tripId),
            liveTrip(),
            isNotNull(tripAssignments.trainingPlanInstructorPersonId),
          ),
        ),
    () =>
      db
        .select({
          bookingId: bookings.id,
          instructorPersonId: bookings.trainingPlanInstructorPersonId,
        })
        .from(bookings)
        .innerJoin(trips, eq(trips.id, bookings.tripId))
        .where(
          and(
            eq(bookings.shopId, shopId),
            eq(trips.shopId, shopId),
            eq(trips.id, tripId),
            liveTrip(),
            isNotNull(bookings.trainingPlanInstructorPersonId),
          ),
        ),
  ]);
  return { assistants, students };
}
