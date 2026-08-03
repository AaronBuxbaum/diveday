"use server";

import { revalidatePath } from "next/cache";
import { canPersonErasePersonalData } from "@/db/authz";
import { getDb } from "@/db/client";
import { retryMediaDeletion } from "@/db/media-deletions";
import { dischargeProcessorErasure, retryProcessorErasure } from "@/db/processor-erasure";
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
 * Re-attempt a Stripe customer delete erasure could not land
 * (ADR 20260803-processor-erasure-obligations) — the manual companion to the
 * nightly retry, for an owner who has just fixed whatever was broken (a
 * reconnected Stripe account, an outage that has passed) and does not want to
 * wait for the next tick.
 *
 * Same erasure gate as the attestation below: this makes a destructive call
 * against the shop's Stripe account, so it is not a reports-reader's button.
 */
export async function retryProcessorErasureAction(shopSlug: string, formData: FormData) {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonErasePersonalData(db, session.user.shopId, session.user.personId))) return;
  const obligationId = String(formData.get("obligationId") ?? "");
  if (!obligationId) return;
  await retryProcessorErasure(db, session.user.shopId, obligationId);
  revalidatePath(`/shop/${shopSlug}/reports`);
}

/**
 * Mark a processor-side erasure done (ADR 20260803-processor-erasure-obligations).
 *
 * This is the *only* way an invoice-snapshot obligation ever closes: no API
 * reaches the name and email Stripe copied onto a finalized invoice, so an
 * owner attests they filed Stripe's data-deletion request.
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
