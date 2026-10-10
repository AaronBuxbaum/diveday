"use server";

import { revalidatePath } from "next/cache";
import { canPersonErasePersonalData, canPersonManageShopSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { retryMediaDeletion } from "@/db/media-deletions";
import { dischargeProcessorErasure, retryProcessorErasure } from "@/db/processor-erasure";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

/* -------------------------------------------------------------------------- *
 * Data-compliance queues (the "Data" group)
 *
 * Two jobs the shop still owes on data it promised to remove: a stored file a
 * provider delete never got rid of (CR-012) and an erasure that didn't land at
 * Stripe (ADR 20260803-processor-erasure-obligations). They lived at the bottom
 * of the monthly report until the report became only a report; "what happened
 * to data we said we'd delete?" is the Data group's question, and this page is
 * where it is now asked.
 *
 * The gates are unchanged in substance. The media retry moved from the reports
 * gate to the settings gate — the same `isOwnerOrManager` role set, so nobody
 * gained or lost the button — and both processor-erasure actions keep the
 * owner-only `canPersonErasePersonalData` they always had. Each re-checks
 * server-side and returns silently on refusal rather than trusting the page
 * that rendered the form.
 *
 * They call the predicates directly rather than through `settingsBlock` above:
 * that helper hands back a `?notice=not-authorized` redirect target, which is
 * the right answer for a card the page renders for everyone and wrong for a
 * panel it renders for nobody who would be refused. A hand-made post here gets
 * silence, not an explanation of a control that was never on screen.
 *
 * The path they revalidate comes from `session.user.shopSlug`, never from a
 * bound argument. A server action's arguments are attacker-controlled — the
 * action id ships to the browser and a hand-crafted POST supplies whatever it
 * likes — so a bound slug would let a signed-in staffer of shop A invalidate
 * shop B's cached settings page. The writes above were never at risk (every
 * one is scoped by `session.user.shopId`); this closes the cache-invalidation
 * half, and matches how `settingsBlock` and the rest of this file already
 * derive the slug.
 * -------------------------------------------------------------------------- */

/**
 * The "Retry" for a stuck provider delete (CR-012) — same owner/manager weight
 * as every other control on this page, so a crew member can't reach it by
 * posting directly to the action.
 */
export async function retryMediaDeletionAction(formData: FormData) {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonManageShopSettings(db, session.user.shopId, session.user.personId))) return;
  const attemptId = String(formData.get("attemptId") ?? "");
  if (!attemptId) return;
  await retryMediaDeletion(db, session.user.shopId, attemptId);
  revalidatePath(shopPath(session.user.shopSlug, "settings"));
}

/**
 * Re-attempt a Stripe customer delete erasure could not land
 * (ADR 20260803-processor-erasure-obligations) — the manual companion to the
 * nightly retry, for an owner who has just fixed whatever was broken (a
 * reconnected Stripe account, an outage that has passed) and does not want to
 * wait for the next tick.
 *
 * Same erasure gate as the attestation below: this makes a destructive call
 * against the shop's Stripe account, so it is not a settings-reader's button.
 */
export async function retryProcessorErasureAction(formData: FormData) {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonErasePersonalData(db, session.user.shopId, session.user.personId))) return;
  const obligationId = String(formData.get("obligationId") ?? "");
  if (!obligationId) return;
  await retryProcessorErasure(db, session.user.shopId, obligationId);
  revalidatePath(shopPath(session.user.shopSlug, "settings"));
}

/**
 * Mark a processor-side erasure done (ADR 20260803-processor-erasure-obligations).
 *
 * This is the *only* way an invoice-snapshot obligation ever closes: no API
 * reaches the name and email Stripe copied onto a finalized invoice, so an
 * owner attests they filed Stripe's data-deletion request.
 *
 * Gated on `canPersonErasePersonalData`, not on the settings gate the panel is
 * *read* behind: this is an attestation that a diver's data is gone from
 * Stripe, and only the role that could order the erasure may declare it
 * finished. A manager who can read the panel sees the outstanding work and
 * cannot sign it off.
 */
export async function dischargeProcessorErasureAction(formData: FormData) {
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
  revalidatePath(shopPath(session.user.shopSlug, "settings"));
}
