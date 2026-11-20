"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { issueCourseCode, releaseCourseCode } from "@/db/course-codes";
import { formValue, readForm, text } from "@/features/form-parse";
import { revalidateAndRedirect } from "@/features/navigation";
import { requireShopSurface } from "@/features/session";
import { noticeUrl } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { requireRosterBooking, tripPath } from "./roster-booking";

const elearningCodeForm = z.object({ bookingId: text(), give: formValue() });

/**
 * **Hand a student an eLearning code from the roster, or take theirs back into stock** (ADR
 * 20261120-course-elearning-codes). Any live staffer, like the materials tick: the desk that hears
 * "I never got my code" is not always the instructor. The writer refuses a departure with no course
 * and another shop's seat, and an empty stock says so rather than failing. Informs, never gates.
 */
export async function setElearningCodeAction(shopSlug: string, tripId: string, formData: FormData) {
  const fields = readForm(elearningCodeForm, formData);
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = fields.bookingId;
  if (!uuidParam(tripId) || !uuidParam(bookingId)) redirect(back);
  const db = await getDb();
  await requireRosterBooking(db, s.user.shopId, tripId, bookingId, back);

  if (fields.give === "true") {
    const outcome = await issueCourseCode(db, {
      shopId: s.user.shopId,
      bookingId,
      staffPersonId: s.user.personId,
    });
    const code = outcome.ok
      ? "code-given"
      : outcome.reason === "none_left"
        ? "code-none-left"
        : "invalid";
    revalidateAndRedirect(back, noticeUrl(back, code, { bid: bookingId }));
  }
  await releaseCourseCode(db, { shopId: s.user.shopId, bookingId });
  revalidateAndRedirect(back, noticeUrl(back, "code-released", { bid: bookingId }));
}
