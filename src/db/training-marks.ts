import { and, eq, gte, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { canConfigureTrips, canManageWaiverTemplates } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { outstandingCourseForms } from "@/lib/course-forms";
import type { ParticipantType } from "@/lib/participant-types";
import { type TrainingMarkProblem, trainingMarkProblem } from "@/lib/training-mark";
import { hasReturned } from "@/lib/trips";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { courseFormSignaturesForBookings, requiredCourseFormsForTrips } from "./course-forms";
import { publishManifestEvent } from "./manifest-events";
import { queryAll } from "./query-helpers";
import { activityEvents, bookings, courses, people, shops, tripDives, trips } from "./schema";
import {
  aboardKey,
  readTrainingEnrollments,
  resolveTrainingMarks,
  seatWithinRoom,
  type TrainingEnrollmentRow,
  teachesSessionAsRostered,
  trainingDiveRoom,
} from "./training-mark-resolve";
import { livePerson, liveTrip } from "./trips-live";

/**
 * **Training marks** (issue #2275, ADR
 * 20261012-course-forms-on-charters-and-counter): a staffer says a seat on an
 * ordinary departure carries a training dive for the diver's course seat, so
 * boarding asks that course's forms on it. Never inferred: only these two
 * writers set or clear a mark, each attributed, logged and pushed to the
 * departure's manifest (and so to the crew's offline copy).
 *
 * Codes, never sentences.
 */

export type MarkTrainingDiveOutcome =
  | { ok: true; changed: boolean }
  | {
      ok: false;
      reason:
        | "not_authorized"
        /** Not a live seat of this shop on a live departure. */
        | "not_found"
        | "departure_over"
        /** The seat is held for staff to confirm who it is (H-20260724-one-person-per-email). */
        | "seat_held"
        /** One enrollment per seat: clear the mark before naming another. */
        | "already_marked"
        /** The session has already ended: nothing more can be signed for it. */
        | "enrollment_ended"
        | TrainingMarkProblem;
    };

/** The seat a writer locks before it reads or changes the mark. */
async function lockSeat(tx: DbExecutor, shopId: string, bookingId: string) {
  const [seat] = await tx
    .select({
      bookingId: bookings.id,
      personId: bookings.personId,
      diverName: people.fullName,
      status: bookings.status,
      participantType: bookings.participantType,
      identityUnconfirmedAt: bookings.identityUnconfirmedAt,
      minorDeclaredAt: bookings.minorDeclaredAt,
      enrollmentBookingId: bookings.trainingEnrollmentBookingId,
      tripId: trips.id,
      tripStatus: trips.status,
      courseId: trips.courseId,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, shopId),
        eq(trips.shopId, shopId),
        eq(people.shopId, shopId),
        liveTrip(),
      ),
    )
    .limit(1)
    .for("update", { of: bookings });
  return seat ?? null;
}

async function staffName(tx: DbExecutor, shopId: string, personId: string): Promise<string> {
  const [row] = await tx
    .select({ name: people.fullName })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.shopId, shopId), livePerson()))
    .limit(1);
  return row?.name ?? "";
}

/**
 * **Mark a seat as a training dive for one of the diver's course seats.**
 * Owner, manager or instructor (`canConfigureTrips`, as the ADR names).
 *
 * Refused unless every condition of `trainingMarkProblem` holds, and also on
 * a held seat, a departure that is over, a session that has already ended,
 * and a seat already marked for another enrollment: one enrollment per seat,
 * so a second course never quietly replaces the first. Marking the same
 * enrollment twice changes nothing.
 */
export async function markTrainingDive(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    enrollmentBookingId: string;
    actorPersonId: string;
    now?: Date;
  },
): Promise<MarkTrainingDiveOutcome> {
  const now = input.now ?? nowDate();
  const outcome = await db.transaction(
    async (tx): Promise<MarkTrainingDiveOutcome & { tripId?: string }> => {
      const roles = await loadActiveStaffRoles(tx, input.shopId, input.actorPersonId);
      if (!roles || !canConfigureTrips(roles)) return { ok: false, reason: "not_authorized" };
      const seat = await lockSeat(tx, input.shopId, input.bookingId);
      if (!seat || seat.status === "cancelled" || seat.tripStatus === "cancelled") {
        return { ok: false, reason: "not_found" };
      }
      if (hasReturned(seat.endsAt, now)) return { ok: false, reason: "departure_over" };
      if (seat.identityUnconfirmedAt !== null) return { ok: false, reason: "seat_held" };
      if (seat.enrollmentBookingId !== null) {
        return seat.enrollmentBookingId === input.enrollmentBookingId
          ? { ok: true, changed: false }
          : { ok: false, reason: "already_marked" };
      }
      const enrollment =
        (await readTrainingEnrollments(tx, input.shopId, [input.enrollmentBookingId])).get(
          input.enrollmentBookingId,
        ) ?? null;
      const problem = trainingMarkProblem(
        {
          personId: seat.personId,
          participantType: seat.participantType as ParticipantType,
          onCourseSession: seat.courseId !== null,
          departureStartsAt: seat.startsAt,
        },
        enrollment,
      );
      if (problem) return { ok: false, reason: problem };
      if (!enrollment) return { ok: false, reason: "enrollment_missing" };
      if (hasReturned(enrollment.sessionEndsAt, now)) {
        return { ok: false, reason: "enrollment_ended" };
      }
      await tx
        .update(bookings)
        .set({
          trainingEnrollmentBookingId: input.enrollmentBookingId,
          trainingPlanInstructorPersonId: null,
          trainingPlanByPersonId: null,
          trainingPlanAt: null,
          trainingMarkedAt: now,
          trainingMarkedByPersonId: input.actorPersonId,
        })
        .where(and(eq(bookings.id, seat.bookingId), eq(bookings.shopId, input.shopId)));
      await tx.insert(activityEvents).values({
        shopId: input.shopId,
        tripId: seat.tripId,
        bookingId: seat.bookingId,
        actorPersonId: input.actorPersonId,
        code: "training_dive_marked",
        params: {
          actor: await staffName(tx, input.shopId, input.actorPersonId),
          diver: seat.diverName,
          course: enrollment.courseTitle,
        },
        occurredAt: now,
      });
      return { ok: true, changed: true, tripId: seat.tripId };
    },
  );
  // The crew's copy, the offline one included, reads the new blockers. After
  // commit, never inside it (`cancelBooking`'s note).
  if (outcome.ok && outcome.tripId) await publishManifestEvent(db, input.shopId, outcome.tripId);
  const { tripId: _tripId, ...result } = outcome;
  return result as MarkTrainingDiveOutcome;
}

export type ClearTrainingDiveOutcome =
  | { ok: true; changed: boolean }
  | {
      ok: false;
      reason:
        | "not_authorized"
        | "not_found"
        /** The charter is home: its marks stay as they sailed. */
        | "departure_over"
        /**
         * Forms are still owed, or the mark no longer stands, and the staffer
         * may neither manage the shop's forms nor teaches the enrollment.
         */
        | "forms_owed";
    };

/**
 * Whether the enrollment a mark names still owes any of its course's forms,
 * from its own records, as boarding reads them (`outstandingCourseForms`):
 * the student's date of birth, and either seat's "Under 18". An enrollment
 * this cannot read, or another person's, owes (fail closed).
 */
async function enrollmentOwesForms(
  tx: DbExecutor,
  shopId: string,
  enrollment: TrainingEnrollmentRow | null,
  seat: { personId: string; minorDeclaredAt: Date | null },
  now: Date,
): Promise<boolean> {
  if (!enrollment || enrollment.personId !== seat.personId) return true;
  const [required, signatures, signerRows] = await queryAll(tx, [
    () => requiredCourseFormsForTrips(tx, shopId, [enrollment.tripId], now),
    () => courseFormSignaturesForBookings(tx, shopId, [enrollment.bookingId]),
    () =>
      tx
        .select({ dateOfBirth: people.dateOfBirth, timezone: shops.timezone })
        .from(people)
        .innerJoin(shops, eq(shops.id, people.shopId))
        // diveday:allow-deleted-people: the student's date of birth, read for the guardian rule.
        .where(and(eq(people.id, seat.personId), eq(people.shopId, shopId)))
        .limit(1),
  ]);
  const [signer] = signerRows;
  if (!signer) return true;
  return (
    outstandingCourseForms({
      shopId,
      bookingId: enrollment.bookingId,
      personId: enrollment.personId,
      required: required.get(enrollment.tripId) ?? [],
      signatures,
      signer: {
        dateOfBirth: signer.dateOfBirth,
        minorDeclared: enrollment.minorDeclared || seat.minorDeclaredAt !== null,
        timezone: signer.timezone,
      },
    }).length > 0
  );
}

/**
 * **Clear a seat's training mark.** Owner, manager or instructor, as marking
 * is (`canConfigureTrips`) — except that clearing a mark whose forms are still
 * owed, or one that no longer stands, relaxes a boarding block, so it takes
 * someone who manages the shop's forms (`canManageWaiverTemplates`) or the
 * enrollment's own rostered instructor (dive-domain review item 4). That
 * clear is stamped on the seat for the manifest to name, and logged.
 */
export async function clearTrainingDive(
  db: AppDb,
  input: { shopId: string; bookingId: string; actorPersonId: string; now?: Date },
): Promise<ClearTrainingDiveOutcome> {
  const now = input.now ?? nowDate();
  const outcome = await db.transaction(
    async (tx): Promise<ClearTrainingDiveOutcome & { tripId?: string }> => {
      const roles = await loadActiveStaffRoles(tx, input.shopId, input.actorPersonId);
      if (!roles || !canConfigureTrips(roles)) return { ok: false, reason: "not_authorized" };
      const seat = await lockSeat(tx, input.shopId, input.bookingId);
      if (!seat) return { ok: false, reason: "not_found" };
      if (seat.enrollmentBookingId === null) return { ok: true, changed: false };
      // Home is final: the record of what the seat was asked stays as it sailed.
      if (hasReturned(seat.endsAt, now)) return { ok: false, reason: "departure_over" };
      const state = (
        await resolveTrainingMarks(tx, input.shopId, [
          {
            bookingId: seat.bookingId,
            tripId: seat.tripId,
            enrollmentBookingId: seat.enrollmentBookingId,
            seat: {
              personId: seat.personId,
              participantType: seat.participantType as ParticipantType,
              onCourseSession: seat.courseId !== null,
              departureStartsAt: seat.startsAt,
            },
          },
        ])
      ).get(seat.bookingId);
      const enrollment =
        (await readTrainingEnrollments(tx, input.shopId, [seat.enrollmentBookingId])).get(
          seat.enrollmentBookingId,
        ) ?? null;
      // Owed whatever the course-forms switch says: a warned form is still a
      // form nobody signed. Read off the enrollment's own records, whether or
      // not the mark still stands (build review T6).
      const formsOwed = await enrollmentOwesForms(tx, input.shopId, enrollment, seat, now);
      // What this clear relaxes, if anything, and so what the seat is stamped.
      const reason = formsOwed ? "forms_owed" : state?.valid ? null : "mark_invalid";
      if (
        reason !== null &&
        !canManageWaiverTemplates(roles) &&
        !(
          enrollment &&
          (await teachesSessionAsRostered(tx, input.shopId, enrollment.tripId, input.actorPersonId))
        )
      ) {
        return { ok: false, reason: "forms_owed" };
      }
      await tx
        .update(bookings)
        .set({
          trainingEnrollmentBookingId: null,
          trainingPlanInstructorPersonId: null,
          trainingPlanByPersonId: null,
          trainingPlanAt: null,
          trainingMarkedAt: null,
          trainingMarkedByPersonId: null,
          // This clear's own stamp, replacing any earlier one: null when it
          // relaxed nothing (security review U5).
          trainingClearedAt: reason ? now : null,
          trainingClearedByPersonId: reason ? input.actorPersonId : null,
          trainingClearedReason: reason,
        })
        .where(and(eq(bookings.id, seat.bookingId), eq(bookings.shopId, input.shopId)));
      await tx.insert(activityEvents).values({
        shopId: input.shopId,
        tripId: seat.tripId,
        bookingId: seat.bookingId,
        actorPersonId: input.actorPersonId,
        code: "training_dive_cleared",
        params: {
          actor: await staffName(tx, input.shopId, input.actorPersonId),
          diver: seat.diverName,
          course: enrollment?.courseTitle ?? "",
          formsOwed: formsOwed ? "yes" : "no",
        },
        occurredAt: now,
      });
      return { ok: true, changed: true, tripId: seat.tripId };
    },
  );
  if (outcome.ok && outcome.tripId) await publishManifestEvent(db, input.shopId, outcome.tripId);
  const { tripId: _tripId, ...result } = outcome;
  return result as ClearTrainingDiveOutcome;
}

/** A course seat a staffer may mark a dive as training for. */
export type TrainingEnrollmentOption = {
  enrollmentBookingId: string;
  courseTitle: string;
  sessionStartsAt: Date;
};

/** What a roster row shows about one seat's training mark. */
export type TrainingMarkRosterSeat = {
  mark: {
    enrollmentBookingId: string;
    courseTitle: string | null;
    /** Recorded course type, when known; this does not identify an underwater group. */
    intro?: boolean;
    sessionStartsAt: Date | null;
    valid: boolean;
    /**
     * An instructor of the course's session is aboard this departure for this
     * seat (`courseInstructorAboard`, issue #2731): rostered by someone else,
     * not counted off at the crew count, within the course ratio. The seat
     * then takes the course's level where the course reaches it; the row
     * warns when not.
     */
    courseInstructorAboard: boolean;
    /** A seat-level mark cannot identify one dive on a multi-dive departure. */
    siteAttributionUnknown?: boolean;
    markedAt: Date;
    markedByName: string | null;
  } | null;
  /** The diver's course seats a mark may name; empty when there are none, or a mark is set. */
  options: TrainingEnrollmentOption[];
  /** A mark someone cleared while its forms were owed: the manifest's line. */
  clearedWithFormsOwed: { at: Date; byName: string | null } | null;
};

type RosterSeatInput = {
  bookingId: string;
  personId: string;
  participantType: ParticipantType;
  status: string;
  identityHeld: boolean;
  trainingEnrollmentBookingId: string | null;
  trainingMarkedAt: Date | null;
  trainingMarkedByPersonId: string | null;
  trainingClearedAt: Date | null;
  trainingClearedByPersonId: string | null;
  trainingClearedReason: "forms_owed" | "mark_invalid" | null;
};

/**
 * **The training-mark lines of one departure's roster**, by seat: the mark
 * and whether it stands, the diver's course seats a mark may name, and a clear
 * made with forms owed. Read only on a departure that is not a course session;
 * the options only while the departure is not over, and only for a live,
 * confirmed diver seat. A session the read offers is live, at this shop, the
 * same person's, not held, and ends no earlier than this departure leaves and
 * not yet — the writer's own conditions, so the control never offers a mark
 * the writer refuses.
 *
 * Each mark says whether the course's instructor is aboard
 * (`courseInstructorAboard`), for the warning beside it (dive-domain review
 * item 5) and the level the seat answers to (issue #2731).
 */
export async function trainingMarksForRoster(
  db: DbExecutor,
  shopId: string,
  trip: {
    id: string;
    courseId: string | null;
    startsAt: Date;
    endsAt: Date;
    plannedDives: number;
  },
  seats: readonly RosterSeatInput[],
  now: Date = nowDate(),
): Promise<{ bySeat: Map<string, TrainingMarkRosterSeat> }> {
  const bySeat = new Map<string, TrainingMarkRosterSeat>();
  if (trip.courseId !== null || seats.length === 0) return { bySeat };
  const marked = seats.filter((seat) => seat.trainingEnrollmentBookingId !== null);
  const offerable = hasReturned(trip.endsAt, now)
    ? []
    : seats.filter(
        (seat) =>
          seat.trainingEnrollmentBookingId === null &&
          seat.status !== "cancelled" &&
          !seat.identityHeld &&
          seat.participantType === "diver",
      );
  const plannedSites =
    marked.length === 0
      ? []
      : await db
          .select({ id: tripDives.diveSiteId })
          .from(tripDives)
          .where(eq(tripDives.tripId, trip.id));
  const siteIds = new Set(plannedSites.map((site) => site.id).filter(Boolean));
  const siteAttributionUnknown = trip.plannedDives !== 1 || siteIds.size !== 1;
  const staffIds = [
    ...new Set(
      seats.flatMap((seat) =>
        [seat.trainingMarkedByPersonId, seat.trainingClearedByPersonId].filter(
          (id): id is string => id !== null,
        ),
      ),
    ),
  ];
  const [enrollments, optionRows, staffRows] = await queryAll(db, [
    () =>
      readTrainingEnrollments(
        db,
        shopId,
        marked.map((seat) => seat.trainingEnrollmentBookingId as string),
      ),
    () =>
      offerable.length === 0
        ? Promise.resolve([])
        : db
            .select({
              bookingId: bookings.id,
              personId: bookings.personId,
              courseTitle: courses.title,
              tripTitle: trips.title,
              startsAt: trips.startsAt,
              endsAt: trips.endsAt,
            })
            .from(bookings)
            .innerJoin(trips, eq(trips.id, bookings.tripId))
            .leftJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, shopId)))
            .where(
              and(
                eq(bookings.shopId, shopId),
                eq(trips.shopId, shopId),
                inArray(bookings.personId, [...new Set(offerable.map((seat) => seat.personId))]),
                ne(bookings.status, "cancelled"),
                eq(bookings.participantType, "diver"),
                isNull(bookings.identityUnconfirmedAt),
                ne(trips.status, "cancelled"),
                isNotNull(trips.courseId),
                gte(trips.endsAt, trip.startsAt),
                liveTrip(),
              ),
            ),
    () =>
      staffIds.length === 0
        ? Promise.resolve([])
        : db
            .select({ id: people.id, name: people.fullName })
            .from(people)
            // diveday:allow-deleted-people: the name of whoever marked or cleared, kept as history.
            .where(and(eq(people.shopId, shopId), inArray(people.id, staffIds))),
  ]);
  const room = await trainingDiveRoom(
    db,
    shopId,
    [...enrollments.values()].map((enrollment) => ({
      departureTripId: trip.id,
      sessionTripId: enrollment.tripId,
      course: enrollment.course,
    })),
  );
  const nameById = new Map(staffRows.map((row) => [row.id, row.name]));
  const optionsByPerson = new Map<string, TrainingEnrollmentOption[]>();
  for (const row of optionRows) {
    if (hasReturned(row.endsAt, now)) continue;
    const list = optionsByPerson.get(row.personId) ?? [];
    list.push({
      enrollmentBookingId: row.bookingId,
      courseTitle: row.courseTitle ?? row.tripTitle,
      sessionStartsAt: row.startsAt,
    });
    optionsByPerson.set(row.personId, list);
  }
  for (const list of optionsByPerson.values()) {
    list.sort((a, b) => a.sessionStartsAt.getTime() - b.sessionStartsAt.getTime());
  }
  for (const seat of seats) {
    const enrollmentId = seat.trainingEnrollmentBookingId;
    const enrollment = enrollmentId ? enrollments.get(enrollmentId) : undefined;
    // The same rule every reader asks (`trainingMarkProblem`), over the row just read.
    const valid =
      enrollmentId !== null &&
      trainingMarkProblem(
        {
          personId: seat.personId,
          participantType: seat.participantType,
          onCourseSession: false,
          departureStartsAt: trip.startsAt,
        },
        enrollment ?? null,
      ) === null;
    const mark =
      enrollmentId && seat.trainingMarkedAt
        ? {
            enrollmentBookingId: enrollmentId,
            courseTitle: enrollment?.courseTitle ?? null,
            ...(enrollment?.course && !seat.identityHeld ? { intro: enrollment.course.intro } : {}),
            sessionStartsAt: enrollment?.sessionStartsAt ?? null,
            valid,
            courseInstructorAboard:
              enrollment !== undefined &&
              seatWithinRoom(room.get(aboardKey(trip.id, enrollment.tripId)), seat.bookingId),
            ...(siteAttributionUnknown ? { siteAttributionUnknown: true } : {}),
            markedAt: seat.trainingMarkedAt,
            markedByName: seat.trainingMarkedByPersonId
              ? (nameById.get(seat.trainingMarkedByPersonId) ?? null)
              : null,
          }
        : null;
    const options = offerable.includes(seat) ? (optionsByPerson.get(seat.personId) ?? []) : [];
    const clearedWithFormsOwed =
      seat.trainingClearedAt && seat.trainingClearedReason === "forms_owed"
        ? {
            at: seat.trainingClearedAt,
            byName: seat.trainingClearedByPersonId
              ? (nameById.get(seat.trainingClearedByPersonId) ?? null)
              : null,
          }
        : null;
    if (!mark && options.length === 0 && !clearedWithFormsOwed) continue;
    bySeat.set(seat.bookingId, { mark, options, clearedWithFormsOwed });
  }
  return { bySeat };
}

/**
 * **A seat that stops diving drops its training mark**, inside the type
 * change's own transaction (build review T6): a snorkeler or a rider is asked
 * none of a course's forms, and a mark left behind would only raise
 * `training_mark_invalid` on a seat nobody can mark again. Logged as a clear
 * by the staffer who changed the type; nothing was relaxed, so nothing is
 * stamped. True when a mark was dropped, so the caller knows the manifest
 * moved (it publishes the seat's departure already).
 */
export async function dropTrainingMarkWithin(
  tx: DbExecutor,
  input: { shopId: string; bookingId: string; actorPersonId: string; now: Date },
): Promise<boolean> {
  const seat = await lockSeat(tx, input.shopId, input.bookingId);
  if (!seat || seat.enrollmentBookingId === null) return false;
  const enrollment =
    (await readTrainingEnrollments(tx, input.shopId, [seat.enrollmentBookingId])).get(
      seat.enrollmentBookingId,
    ) ?? null;
  await tx
    .update(bookings)
    .set({
      trainingEnrollmentBookingId: null,
      trainingPlanInstructorPersonId: null,
      trainingPlanByPersonId: null,
      trainingPlanAt: null,
      trainingMarkedAt: null,
      trainingMarkedByPersonId: null,
    })
    .where(and(eq(bookings.id, seat.bookingId), eq(bookings.shopId, input.shopId)));
  await tx.insert(activityEvents).values({
    shopId: input.shopId,
    tripId: seat.tripId,
    bookingId: seat.bookingId,
    actorPersonId: input.actorPersonId,
    code: "training_dive_cleared",
    params: {
      actor: await staffName(tx, input.shopId, input.actorPersonId),
      diver: seat.diverName,
      course: enrollment?.courseTitle ?? "",
      formsOwed: "no",
    },
    occurredAt: input.now,
  });
  return true;
}
