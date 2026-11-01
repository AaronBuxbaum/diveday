"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { recordCourseMaterialsDone } from "@/db/course-materials";
import { seatForElearningCheck } from "@/db/elearning-check";
import { ELEARNING_PAGE_TEXT_MAX_LENGTH, judgeElearningPage } from "@/lib/elearning-check";
import { formValue, readForm, text } from "@/lib/form-parse";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";
import { tripPath } from "./roster-booking";

export type ElearningCheckResult =
  | null
  /** PADI shows this course finished; the materials are ticked done. */
  | {
      ok: true;
      verdict: "complete";
      evidence: string;
      undo: { bookingId: string; markedAt: string };
    }
  /** Somebody had already ticked them; nothing changed. */
  | { ok: true; verdict: "already_done" }
  | { ok: true; verdict: "undone" }
  /** The student is on the page, this course is not shown finished. */
  | { ok: true; verdict: "not_complete"; evidence: string }
  | { ok: true; verdict: "no_record" | "unreadable" }
  | { ok: false; reason: "invalid" };

/**
 * The check's fields as posted: the seat, whether this is an undo, and the
 * page text the staffer pasted, each read as `FormData.get` read it.
 */
const elearningForm = z.object({
  bookingId: text(),
  intent: formValue(),
  markedAt: formValue(),
  pageText: formValue(),
});

/**
 * **Tick a student's learning materials done from PADI's own eLearning page**
 * (H-20261008-padi-elearning-check).
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
  const fields = readForm(elearningForm, formData);
  const staff = (await requireShopSurface(shopSlug)).session;
  const trip = uuidParam(tripId);
  const bookingId = uuidParam(fields.bookingId);
  if (!trip || !bookingId) return { ok: false, reason: "invalid" };
  const shopId = staff.user.shopId;
  const db = await getDb();
  const back = tripPath(shopSlug, trip);
  const seat = await seatForElearningCheck(db, { shopId, tripId: trip, bookingId });
  if (!seat) return { ok: false, reason: "invalid" };

  if (fields.intent === "undo") {
    // Undo takes back only the tick the check made: a tick stamped by a
    // colleague, or re-made by anyone since (a newer stamp), stays.
    if (!seat.materialsDoneAt) return { ok: true, verdict: "undone" };
    if (
      seat.materialsDoneBy !== staff.user.personId ||
      fields.markedAt !== seat.materialsDoneAt.toISOString()
    ) {
      return { ok: true, verdict: "already_done" };
    }
    const undone = await recordCourseMaterialsDone(db, {
      shopId,
      bookingId,
      staffPersonId: staff.user.personId,
      done: false,
      // The same test again, inside the UPDATE: a re-tick since the read stays.
      onlyIf: { byPersonId: staff.user.personId, markedAt: seat.materialsDoneAt },
    });
    revalidatePath(back);
    if (!undone.ok && undone.reason === "changed") return { ok: true, verdict: "already_done" };
    return undone.ok ? { ok: true, verdict: "undone" } : { ok: false, reason: "invalid" };
  }

  if (seat.materialsDone) return { ok: true, verdict: "already_done" };
  const pageText = fields.pageText;
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
  const marked = await seatForElearningCheck(db, { shopId, tripId: trip, bookingId });
  if (!marked?.materialsDoneAt) return { ok: false, reason: "invalid" };
  return {
    ok: true,
    verdict: "complete",
    evidence: judged.evidence,
    undo: { bookingId, markedAt: marked.materialsDoneAt.toISOString() },
  };
}
