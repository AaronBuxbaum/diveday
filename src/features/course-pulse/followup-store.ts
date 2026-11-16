import { and, eq, isNull, sql } from "drizzle-orm";
import { readActiveStaffRoles } from "@/db/authz";
import type { AppDb } from "@/db/client";
import { recordActivityRow } from "@/db/operations";
import {
  bookings,
  people,
  personRoles,
  shops,
  tripAssignments,
  trips,
  userAccounts,
} from "@/db/schema";
import { livePerson, liveTrip, seatNotCancelled } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { getCoursePulse } from "./store";

export type CourseFollowupResult = { ok: true } | { ok: false; reason: "changed" | "unavailable" };

/** A claim owns work, never the student's preparedness. Only source facts clear the gaps. */
export async function claimCourseFollowup(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    bookingId: string;
    personId: string;
    expectedRevision: number;
    intent: "claim" | "release";
  },
): Promise<CourseFollowupResult> {
  if (
    (input.intent !== "claim" && input.intent !== "release") ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0
  )
    return { ok: false, reason: "unavailable" };
  const pulse = await getCoursePulse(db, input.shopId, input.tripId, input.personId);
  const student = pulse?.rows.find((row) => row.bookingId === input.bookingId);
  const followup = pulse?.followupByBooking.get(input.bookingId);
  if (!student || !followup) return { ok: false, reason: "unavailable" };
  if (followup.revision !== input.expectedRevision) return { ok: false, reason: "changed" };
  if (input.intent === "claim" && (followup.ownerId || !student.items.length))
    return { ok: false, reason: "changed" };
  if (input.intent === "release" && !followup.canRelease)
    return { ok: false, reason: "unavailable" };
  const roles = await readActiveStaffRoles(db, input.shopId, input.personId);
  if (!roles) return { ok: false, reason: "unavailable" };
  return db.transaction(async (tx) => {
    // Conditional update is the race arbiter; the departure and feature switch
    // are checked again in the same statement, including a concurrent cancellation.
    const [recorded] = await tx
      .update(bookings)
      .set({
        courseFollowupByPersonId: input.intent === "claim" ? input.personId : null,
        courseFollowupAt: input.intent === "claim" ? nowDate() : null,
        courseFollowupRevision: sql`${bookings.courseFollowupRevision} + 1`,
      })
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, input.tripId),
          seatNotCancelled,
          eq(bookings.courseFollowupRevision, input.expectedRevision),
          input.intent === "claim"
            ? isNull(bookings.courseFollowupByPersonId)
            : eq(bookings.courseFollowupByPersonId, followup.ownerId ?? input.personId),
          sql`exists (select 1 from ${people}
            inner join ${userAccounts} on ${userAccounts.personId} = ${people.id}
            inner join ${personRoles} on ${personRoles.personId} = ${people.id}
            where ${people.id} = ${input.personId} and ${people.shopId} = ${input.shopId}
              and ${livePerson()} and ${userAccounts.status} = 'active'
              and (${personRoles.role} in ('owner', 'manager')
                or (${personRoles.role} = 'instructor'
                  and (${input.intent} = 'claim' or ${bookings.courseFollowupByPersonId} = ${input.personId})
                  and exists (select 1 from ${tripAssignments}
                    where ${tripAssignments.tripId} = ${input.tripId}
                      and ${tripAssignments.personId} = ${input.personId}
                      and (${tripAssignments.tripRole} = 'instructor' or ${tripAssignments.tripRole} is null)))))`,
          sql`exists (select 1 from ${trips} inner join ${shops} on ${shops.id} = ${trips.shopId}
        where ${trips.id} = ${input.tripId} and ${trips.shopId} = ${input.shopId}
          and ${trips.courseId} is not null and ${trips.status} = 'scheduled'
          and ${liveTrip()} and ${shops.coursePulseEnabled} = true)`,
        ),
      )
      .returning({ personId: bookings.personId });
    if (!recorded) return { ok: false as const, reason: "changed" as const };
    const [actor] = await tx
      .select({ name: people.fullName })
      .from(people)
      .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId), livePerson()));
    await recordActivityRow(tx, {
      shopId: input.shopId,
      tripId: input.tripId,
      bookingId: input.bookingId,
      actorPersonId: input.personId,
      subjectPersonId: recorded.personId,
      code: input.intent === "claim" ? "course_followup_claimed" : "course_followup_released",
      params: { actor: actor?.name ?? "" },
    });
    return { ok: true as const };
  });
}
