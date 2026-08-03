"use server";

import { revalidatePath } from "next/cache";
import { canPersonErasePersonalData } from "@/db/authz";
import { getDb } from "@/db/client";
import { retryMediaDeletion } from "@/db/media-deletions";
import { dischargeProcessorErasure } from "@/db/processor-erasure";
import { canPersonViewShopReports } from "@/db/reporting";
import { requireStaffSession } from "@/lib/session";

/**
 * The owner-visible "Retry" action for a stuck provider delete (CR-012) —
 * same reports-page gate as the page itself, so a manager without report
 * access can't reach it by posting directly to the action.
 */
export async function retryMediaDeletionAction(shopSlug: string, formData: FormData) {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonViewShopReports(db, session.user.shopId, session.user.personId))) return;
  const attemptId = String(formData.get("attemptId") ?? "");
  if (!attemptId) return;
  await retryMediaDeletion(db, session.user.shopId, attemptId);
  revalidatePath(`/shop/${shopSlug}/reports`);
}

/**
 * Mark a processor-side erasure done (ADR 20260803-processor-erasure-obligations).
 *
 * Gated on `canPersonErasePersonalData`, not on the reports gate the panel is
 * *read* behind: this is an attestation that a diver's data is gone from
 * Stripe, and only the role that could order the erasure may declare it
 * finished. A manager who can read the panel sees the outstanding work and
 * cannot sign it off.
 */
export async function dischargeProcessorErasureAction(shopSlug: string, formData: FormData) {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonErasePersonalData(db, session.user.shopId, session.user.personId))) return;
  const obligationId = String(formData.get("obligationId") ?? "");
  if (!obligationId) return;
  await dischargeProcessorErasure(db, {
    shopId: session.user.shopId,
    obligationId,
    actorPersonId: session.user.personId,
  });
  revalidatePath(`/shop/${shopSlug}/reports`);
}
