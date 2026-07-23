"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { retryMediaDeletion } from "@/db/media-deletions";
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
