import { and, eq, gt, isNotNull, ne, notInArray } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { createCourseForm, listCourseForms, setCourseFormRequirements } from "@/db/course-forms";
import { getBookingReadiness } from "@/db/readiness";
import {
  bookings,
  people,
  personRoles,
  tripAssignments,
  tripRequirements,
  trips,
  userAccounts,
} from "@/db/schema";
import { markTrainingDive } from "@/db/training-marks";
import { nowDate } from "@/lib/clock";
import { SEEDED_CAPTAIN_EMAIL, SEEDED_OWNER_EMAIL, seededStaffPersonId } from "./staff-session";

/** The charter, course seat and staff the training-mark suites share (issue #2275). */
const BODY =
  "I understand the course's in-water sessions follow the instructor's plan, and I will tell the instructor before any session if anything about my health changes.";
export const HOUR = 60 * 60 * 1000;

/**
 * A seeded upcoming course session with a live seat on it (the enrollment),
 * a fun-dive charter for the same diver that leaves while the session runs,
 * one form the course asks, and the owner, the captain and an instructor.
 */
export async function charterContext(fileCtx: { db: AppDb; shop: { id: string } }) {
  const { db, shop } = fileCtx;
  const now = nowDate();
  const [course] = await db
    .select({
      bookingId: bookings.id,
      personId: people.id,
      fullName: people.fullName,
      tripId: trips.id,
      courseId: trips.courseId,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shop.id),
        isNotNull(trips.courseId),
        eq(bookings.participantType, "diver"),
        ne(bookings.status, "cancelled"),
        ne(trips.status, "cancelled"),
        gt(trips.startsAt, now),
      ),
    )
    .limit(1);
  if (!course?.courseId) throw new Error("seed has no upcoming course seat");
  await db.update(people).set({ dateOfBirth: "1990-04-02" }).where(eq(people.id, course.personId));
  await db
    .update(bookings)
    .set({ identityUnconfirmedAt: null })
    .where(eq(bookings.id, course.bookingId));
  const [charter] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Afternoon reef charter",
      startsAt: course.startsAt,
      endsAt: new Date(course.startsAt.getTime() + 3 * HOUR),
      capacity: 10,
    })
    .returning();
  if (!charter) throw new Error("charter insert failed");
  await db
    .insert(tripRequirements)
    .values({ shopId: shop.id, tripId: charter.id, requiresWaiver: false });
  const [seat] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId: shop.id, tripId: charter.id, personId: course.personId })
    .returning();
  if (!seat) throw new Error("charter seat insert failed");
  const form = await createCourseForm(db, {
    shopId: shop.id,
    title: "Adventure dive statement",
    body: BODY,
    actorPersonId: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
  });
  const required = await setCourseFormRequirements(db, {
    mayNarrow: true,
    shopId: shop.id,
    courseId: course.courseId,
    formIds: [form.id],
  });
  if (!required.ok) throw new Error("course form requirement refused");
  const summary = (await listCourseForms(db, shop.id)).find((row) => row.id === form.id);
  if (!summary) throw new Error("form missing");
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
  const managers = db
    .select({ id: personRoles.personId })
    .from(personRoles)
    .where(notInArray(personRoles.role, ["instructor", "diver", "crew", "captain"]));
  const [instructor] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .innerJoin(userAccounts, eq(userAccounts.personId, people.id))
    .where(
      and(
        eq(people.shopId, shop.id),
        eq(personRoles.role, "instructor"),
        notInArray(people.id, managers),
        eq(userAccounts.status, "active"),
      ),
    )
    .limit(1);
  if (!instructor) throw new Error("seed has no instructor who is not a manager");
  // Off the session's crew, so each test says whether they teach it.
  await db
    .delete(tripAssignments)
    .where(
      and(eq(tripAssignments.tripId, course.tripId), eq(tripAssignments.personId, instructor.id)),
    );
  return {
    db,
    shop,
    now,
    course: { ...course, courseId: course.courseId },
    charter,
    seat,
    form: summary,
    owner,
    captain,
    instructor: instructor.id,
  };
}

export type CharterContext = Awaited<ReturnType<typeof charterContext>>;

export const markSeat = (
  ctx: CharterContext,
  overrides: { enrollmentBookingId?: string; actorPersonId?: string } = {},
) =>
  markTrainingDive(ctx.db, {
    shopId: ctx.shop.id,
    bookingId: ctx.seat.id,
    enrollmentBookingId: overrides.enrollmentBookingId ?? ctx.course.bookingId,
    actorPersonId: overrides.actorPersonId ?? ctx.owner,
  });

export const seatBlockerCodes = async (ctx: CharterContext) =>
  ((await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.id))?.blockers ?? []).map(
    (blocker) => blocker.code,
  );
