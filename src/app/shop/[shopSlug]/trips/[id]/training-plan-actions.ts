"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { setTrainingPlanAssignment } from "@/db/training-plans";
import { revalidateAndRedirect } from "@/lib/navigation";
import { noticeUrl } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { tripPath } from "./roster-booking";
import { requireTripConfig } from "./trip-config";

export async function saveTrainingPlanAction(shopSlug: string, tripId: string, form: FormData) {
  const session = await requireTripConfig(shopSlug, tripId);
  const back = tripPath(shopSlug, tripId);
  const kind = form.get("kind");
  const id = form.get("id");
  const instructor = form.get("instructor");
  const subjectId = typeof id === "string" ? uuidParam(id) : undefined;
  const teacherId = typeof instructor === "string" && instructor ? uuidParam(instructor) : null;
  if (
    !subjectId ||
    (kind !== "assistant" && kind !== "student") ||
    (instructor !== "" && !teacherId)
  )
    redirect(noticeUrl(back, "training-mark-invalid"));
  const db = await getDb();
  const result = await setTrainingPlanAssignment(db, {
    shopId: session.user.shopId,
    tripId,
    actorPersonId: session.user.personId,
    subject: kind === "assistant" ? { kind, personId: subjectId } : { kind, bookingId: subjectId },
    instructorPersonId: teacherId ?? null,
  });
  revalidateAndRedirect(
    back,
    result.ok ? `${back}#training-plan` : noticeUrl(back, "training-mark-invalid"),
  );
}
