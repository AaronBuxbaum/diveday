"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireStaffSession } from "@/features/accounts/session";
import {
  type CourseFollowupResult,
  type CourseTeachingNoteResult,
  claimCourseFollowup,
  recordCourseTeachingNote,
} from "@/features/training/course-pulse";
import { shopPath } from "@/lib/staff-notices";

export async function saveCourseTeachingNoteAction(
  tripId: string,
  _previous: CourseTeachingNoteResult | null,
  form: FormData,
): Promise<CourseTeachingNoteResult> {
  const session = await requireStaffSession();
  const note = form.get("note");
  const expectedNote = form.get("expectedNote");
  if (
    !z.uuid().safeParse(tripId).success ||
    typeof note !== "string" ||
    typeof expectedNote !== "string"
  )
    return { ok: false, reason: "invalid" };
  const result = await recordCourseTeachingNote(await getDb(), {
    shopId: session.user.shopId,
    tripId,
    personId: session.user.personId,
    note: form.get("intent") === "delete" ? "" : note,
    expectedNote: expectedNote || null,
  });
  if (result.ok) revalidatePath(shopPath(session.user.shopSlug, "trips", tripId));
  return result;
}

export async function claimCourseFollowupAction(
  tripId: string,
  bookingId: string,
  _previous: CourseFollowupResult | null,
  form: FormData,
): Promise<CourseFollowupResult> {
  const session = await requireStaffSession();
  const parsed = z
    .object({
      tripId: z.uuid(),
      bookingId: z.uuid(),
      expectedRevision: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      intent: z.enum(["claim", "release"]),
    })
    .safeParse({
      tripId,
      bookingId,
      expectedRevision: form.get("expectedRevision"),
      intent: form.get("intent"),
    });
  if (!parsed.success) return { ok: false, reason: "unavailable" };
  const result = await claimCourseFollowup(await getDb(), {
    ...parsed.data,
    shopId: session.user.shopId,
    personId: session.user.personId,
  });
  if (result.ok) revalidatePath(shopPath(session.user.shopSlug, "trips", tripId));
  return result;
}
