"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { readForm, text } from "@/features/form-parse";
import { revalidateAndRedirect } from "@/features/navigation";
import { parseReferralPaper } from "@/features/referral-student";
import { markReferralStudent, recordReferralPaper } from "@/features/referral-students";
import { requireShopSurface } from "@/features/session";
import { noticeUrl } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { requireRosterBooking, tripPath } from "./roster-booking";

const referralForm = z.object({ bookingId: text(), act: text(), paper: text() });

/**
 * **A referral student, from the course session's roster** (loop 5, row 10):
 * mark the seat as finished theory and pool elsewhere, take that back, or tick
 * one of the two papers the desk collects. Any live staffer of the shop may,
 * as with the materials tick: the desk is who takes the papers. The writers
 * refuse a departure with no course and a seat of another shop.
 */
export async function referralStudentAction(shopSlug: string, tripId: string, formData: FormData) {
  const fields = readForm(referralForm, formData);
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = fields.bookingId;
  if (!uuidParam(tripId) || !uuidParam(bookingId)) redirect(back);
  const db = await getDb();
  await requireRosterBooking(db, s.user.shopId, tripId, bookingId, back);
  const base = { shopId: s.user.shopId, bookingId, staffPersonId: s.user.personId };
  const paper = parseReferralPaper(fields.paper);
  const outcome =
    fields.act === "mark" || fields.act === "unmark"
      ? await markReferralStudent(db, { ...base, referred: fields.act === "mark" })
      : paper && (fields.act === "collect" || fields.act === "uncollect")
        ? await recordReferralPaper(db, { ...base, paper, collected: fields.act === "collect" })
        : ({ ok: false, reason: "not_found" } as const);
  revalidateAndRedirect(
    back,
    noticeUrl(
      back,
      outcome.ok
        ? "referral-saved"
        : outcome.reason === "not_a_course_session"
          ? "referral-not-a-course"
          : "invalid",
      { bid: bookingId },
    ),
  );
}
