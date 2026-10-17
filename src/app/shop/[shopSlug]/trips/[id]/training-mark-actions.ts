"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  clearTrainingDive,
  type MarkTrainingDiveOutcome,
  markTrainingDive,
} from "@/db/training-marks";
import { readForm, text } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { requireRosterBooking, tripPath } from "./roster-booking";
import { requireTripConfig } from "./trip-config";

/**
 * A training dive on a charter seat (issue #2275), marked and cleared from
 * the departure's Divers tab. Both take `requireTripConfig` (owner, manager,
 * instructor); clearing one with forms owed is narrowed again by the writer.
 * Their gate is pinned beside them (`training-mark-actions.authz.test.ts`).
 */

const trainingMarkForm = z.object({
  bookingId: text(),
  enrollmentBookingId: text(),
});

/** Each refused training mark, as the roster's notice code. */
const TRAINING_MARK_NOTICE: Record<
  Extract<MarkTrainingDiveOutcome, { ok: false }>["reason"],
  string
> = {
  not_authorized: "not-authorized",
  not_found: "training-mark-invalid",
  departure_over: "training-mark-over",
  enrollment_ended: "training-mark-over",
  seat_held: "training-mark-invalid",
  already_marked: "training-mark-already",
  seat_on_course_session: "training-mark-invalid",
  seat_not_diving: "training-mark-invalid",
  enrollment_missing: "training-mark-invalid",
  enrollment_other_person: "training-mark-invalid",
  enrollment_canceled: "training-mark-invalid",
  enrollment_held: "training-mark-invalid",
  enrollment_not_diving: "training-mark-invalid",
  not_a_course_session: "training-mark-invalid",
  ends_before_departure: "training-mark-invalid",
};

/**
 * **Mark a seat on this departure as a training dive** for one of the diver's
 * course seats (issue #2275), so boarding asks that course's forms on it.
 * Trip definition's gate (`requireTripConfig`: owner, manager or instructor),
 * as the ADR names; `markTrainingDive` re-reads the roles and every condition
 * of the mark before it writes, and refuses a second course on a marked seat.
 */
export async function markTrainingDiveAction(shopSlug: string, tripId: string, formData: FormData) {
  const fields = readForm(trainingMarkForm, formData);
  const back = tripPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const bookingId = uuidParam(fields.bookingId);
  const enrollmentBookingId = uuidParam(fields.enrollmentBookingId);
  if (!bookingId || !enrollmentBookingId) redirect(noticeUrl(back, "training-mark-invalid"));
  const db = await getDb();
  await requireRosterBooking(db, s.user.shopId, tripId, bookingId, back);
  const outcome = await markTrainingDive(db, {
    shopId: s.user.shopId,
    bookingId,
    enrollmentBookingId,
    actorPersonId: s.user.personId,
  });
  revalidatePath(shopPath(shopSlug, "trips", tripId, "manifest"));
  revalidateAndRedirect(
    back,
    noticeUrl(back, outcome.ok ? "training-marked" : TRAINING_MARK_NOTICE[outcome.reason], {
      bid: bookingId,
    }),
  );
}

/**
 * **Clear a seat's training mark.** The same gate as marking; clearing one
 * whose forms are still owed (or that no longer stands) relaxes a boarding
 * block, and `clearTrainingDive` then takes only someone who manages the
 * shop's forms or the enrollment's own instructor, and stamps who did it.
 */
export async function clearTrainingDiveAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const fields = readForm(trainingMarkForm, formData);
  const back = tripPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const bookingId = uuidParam(fields.bookingId);
  if (!bookingId) redirect(noticeUrl(back, "training-mark-invalid"));
  const db = await getDb();
  await requireRosterBooking(db, s.user.shopId, tripId, bookingId, back);
  const outcome = await clearTrainingDive(db, {
    shopId: s.user.shopId,
    bookingId,
    actorPersonId: s.user.personId,
  });
  revalidatePath(shopPath(shopSlug, "trips", tripId, "manifest"));
  revalidateAndRedirect(
    back,
    noticeUrl(
      back,
      outcome.ok
        ? "training-cleared"
        : outcome.reason === "forms_owed"
          ? "training-mark-forms-owed"
          : outcome.reason === "not_authorized"
            ? "not-authorized"
            : outcome.reason === "departure_over"
              ? "training-mark-over"
              : "training-mark-invalid",
      { bid: bookingId },
    ),
  );
}
