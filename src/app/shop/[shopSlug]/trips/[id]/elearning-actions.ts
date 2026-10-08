"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { recordCourseMaterialsDone } from "@/db/course-materials";
import { seatForElearningCheck } from "@/db/elearning-check";
import { ELEARNING_PAGE_TEXT_MAX_LENGTH, judgeElearningPage } from "@/lib/elearning-check";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

export type ElearningCheckResult =
  | null
  /** PADI shows this course finished; the materials are ticked done. */
  | { ok: true; verdict: "complete"; evidence: string; undo: { bookingId: string } }
  /** Somebody had already ticked them; nothing changed. */
  | { ok: true; verdict: "already_done" }
  | { ok: true; verdict: "undone" }
  /** The student is on the page, this course is not shown finished. */
  | { ok: true; verdict: "not_complete"; evidence: string }
  | { ok: true; verdict: "no_record" | "unreadable" }
  | { ok: false; reason: "invalid" };

/**
 * **Tick a student's learning materials done from PADI's own eLearning page**
 * (H-106).
 *
 * The DiveDay browser extension, in the staffer's own browser where they are
 * signed in to the PADI Pros' Site, looked the student up by email and handed
 * back the page's text. The verdict is decided here, from the seat, student
 * and course as the database holds them (`seatForElearningCheck`), never from
 * anything the browser claims. A clear "complete" ticks the materials through
 * the roster's own writer, stamped with this staffer; anything else writes
 * nothing. A seat already ticked is left as it was, so the check never moves a
 * colleague's stamp, and its Undo takes back only a tick still stamped with
 * this staffer.
 *
 * Any live staffer of the shop may run it, as any may tick the materials by
 * hand (`setCourseMaterialsDoneAction`).
 */
export async function elearningCheckAction(
  shopSlug: string,
  tripId: string,
  _previous: ElearningCheckResult,
  formData: FormData,
): Promise<ElearningCheckResult> {
  const staff = (await requireShopSurface(shopSlug)).session;
  const trip = uuidParam(tripId);
  const bookingId = uuidParam(String(formData.get("bookingId") ?? ""));
  if (!trip || !bookingId) return { ok: false, reason: "invalid" };
  const shopId = staff.user.shopId;
  const db = await getDb();
  const back = shopPath(shopSlug, "trips", trip);

  const seat = await seatForElearningCheck(db, { shopId, tripId: trip, bookingId });
  if (!seat) return { ok: false, reason: "invalid" };

  if (formData.get("intent") === "undo") {
    // Undo takes back only a tick that is still this staffer's: a colleague
    // who ticked or re-ticked since keeps theirs.
    if (!seat.materialsDone) return { ok: true, verdict: "undone" };
    if (seat.materialsDoneBy !== staff.user.personId) return { ok: true, verdict: "already_done" };
    const undone = await recordCourseMaterialsDone(db, {
      shopId,
      bookingId,
      staffPersonId: staff.user.personId,
      done: false,
    });
    revalidatePath(back);
    return undone.ok ? { ok: true, verdict: "undone" } : { ok: false, reason: "invalid" };
  }

  if (seat.materialsDone) return { ok: true, verdict: "already_done" };
  const pageText = formData.get("pageText");
  if (typeof pageText !== "string") return { ok: false, reason: "invalid" };
  const judged = judgeElearningPage({
    ...seat.query,
    pageText: pageText.slice(0, ELEARNING_PAGE_TEXT_MAX_LENGTH),
  });
  if (judged.verdict === "not_complete") {
    return { ok: true, verdict: "not_complete", evidence: judged.evidence };
  }
  if (judged.verdict !== "complete") return { ok: true, verdict: judged.verdict };

  const outcome = await recordCourseMaterialsDone(db, {
    shopId,
    bookingId,
    staffPersonId: staff.user.personId,
    done: true,
  });
  revalidatePath(back);
  if (!outcome.ok) return { ok: false, reason: "invalid" };
  return { ok: true, verdict: "complete", evidence: judged.evidence, undo: { bookingId } };
}
