"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { type CourseTeachingNoteResult, recordCourseTeachingNote } from "@/features/course-pulse";
import { requireStaffSession } from "@/features/session";
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
