"use server";

import { z } from "zod";
import { canPersonManagePaymentSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import {
  createShopPromoCode,
  deleteShopPromoCode,
  getShopPromoCodeById,
  retryShopPromoCode,
  setShopPromoEnabled,
} from "@/db/shop-promos";
import { revalidateAndRedirect } from "@/lib/navigation";
import { PROMO_DISCOUNT_MAX, PROMO_DISCOUNT_MIN } from "@/lib/promo-codes";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

/**
 * Promo codes discount real money on the shop's own Stripe account, so they
 * are owner/manager work like the rest of payment settings (H-14, ADR
 * 20260724-role-authorization) — re-checked against live roles here, not just
 * hidden from the nav.
 */
async function requirePromoManager() {
  const session = await requireStaffSession();
  const allowed = await canPersonManagePaymentSettings(
    await getDb(),
    session.user.shopId,
    session.user.personId,
  );
  // `shopPath`, not a template: the slug rides in on the session but is still
  // an ordinary string being spliced into a redirect target, and every segment
  // it builds is escaped (src/lib/staff-notices.ts).
  return { session, allowed, promos: shopPath(session.user.shopSlug, "promos") };
}

/** A local date-time from the form to a `Date`, or null for an empty box. */
function parseInstant(raw: FormDataEntryValue | null): Date | null | undefined {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const promoFormSchema = z.object({
  code: z.string().trim().min(1).max(40),
  description: z.string().trim().max(200),
  discountPercent: z.coerce.number().int().min(PROMO_DISCOUNT_MIN).max(PROMO_DISCOUNT_MAX),
  scope: z.enum(["all", "trips", "courses"]),
  maxRedemptions: z.union([z.literal(""), z.coerce.number().int().min(1).max(100_000)]),
});

export async function createPromoAction(formData: FormData) {
  const { session, allowed, promos } = await requirePromoManager();
  if (!allowed) revalidateAndRedirect(promos, noticeUrl(promos, "not-authorized"));

  const parsed = promoFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(promos, noticeUrl(promos, "invalid"));
  const startsAt = parseInstant(formData.get("startsAt"));
  const expiresAt = parseInstant(formData.get("expiresAt"));
  if (startsAt === undefined || expiresAt === undefined) {
    revalidateAndRedirect(promos, noticeUrl(promos, "invalid"));
  }

  const outcome = await createShopPromoCode(await getDb(), {
    shopId: session.user.shopId,
    code: parsed.data.code,
    description: parsed.data.description,
    discountPercent: parsed.data.discountPercent,
    scope: parsed.data.scope,
    startsAt,
    expiresAt,
    maxRedemptions: parsed.data.maxRedemptions === "" ? null : parsed.data.maxRedemptions,
    createdByPersonId: session.user.personId,
  });
  revalidateAndRedirect(promos, noticeUrl(promos, outcome.ok ? "created" : outcome.reason));
}

export async function setPromoEnabledAction(formData: FormData) {
  const { session, allowed, promos } = await requirePromoManager();
  if (!allowed) revalidateAndRedirect(promos, noticeUrl(promos, "not-authorized"));

  const promoId = String(formData.get("promoId") ?? "");
  const enable = formData.get("enable") === "true";
  if (!promoId) revalidateAndRedirect(promos, noticeUrl(promos, "invalid"));
  const changed = await setShopPromoEnabled(await getDb(), session.user.shopId, promoId, enable);
  revalidateAndRedirect(
    promos,
    noticeUrl(promos, changed ? (enable ? "enabled" : "disabled") : "invalid"),
  );
}

/** Re-run Stripe creation for a `failed` code, unchanged from how it was entered. */
export async function retryPromoAction(formData: FormData) {
  const { session, allowed, promos } = await requirePromoManager();
  if (!allowed) revalidateAndRedirect(promos, noticeUrl(promos, "not-authorized"));

  const promoId = String(formData.get("promoId") ?? "");
  if (!promoId) revalidateAndRedirect(promos, noticeUrl(promos, "invalid"));
  const outcome = await retryShopPromoCode(await getDb(), session.user.shopId, promoId);
  revalidateAndRedirect(
    promos,
    noticeUrl(
      promos,
      outcome.ok ? "created" : outcome.reason === "not_found" ? "invalid" : outcome.reason,
    ),
  );
}

/**
 * Remove a code that never went live — `pending` or `failed` only. No confirm
 * dialog: this is one of the two reversible actions in
 * docs/design/principles.md #7, so it lands immediately and the page renders
 * a land-then-undo `<UndoToast>` instead. `deleteShopPromoCode` has no
 * restore of its own (its doc comment), so the row's fields are read here
 * *before* the delete and carried through the redirect — Undo re-runs
 * `restorePromoAction`, which calls `createShopPromoCode` again with them,
 * same as an ordinary "add a promo".
 */
export async function deletePromoAction(formData: FormData) {
  const { session, allowed, promos } = await requirePromoManager();
  if (!allowed) revalidateAndRedirect(promos, noticeUrl(promos, "not-authorized"));

  const promoId = String(formData.get("promoId") ?? "");
  if (!promoId) revalidateAndRedirect(promos, noticeUrl(promos, "invalid"));
  const db = await getDb();
  const existing = await getShopPromoCodeById(db, session.user.shopId, promoId);
  const deleted = await deleteShopPromoCode(db, session.user.shopId, promoId);
  if (!deleted || !existing) {
    revalidateAndRedirect(promos, noticeUrl(promos, deleted ? "deleted" : "invalid"));
  }

  // The row's fields ride back as `noticeUrl`'s `extra` rather than a
  // hand-assembled `URLSearchParams`: an `undefined` value drops out of the
  // query on its own, which is what the four conditional `.set()` calls this
  // replaced were for.
  revalidateAndRedirect(
    promos,
    noticeUrl(promos, "deleted", {
      undoCode: existing.code,
      undoDiscountPercent: existing.discountPercent,
      undoScope: existing.scope,
      undoDescription: existing.description || undefined,
      undoStartsAt: existing.startsAt?.toISOString(),
      undoExpiresAt: existing.expiresAt?.toISOString(),
      undoMaxRedemptions: existing.maxRedemptions === null ? undefined : existing.maxRedemptions,
    }),
  );
}

/**
 * Undo a promo delete from the land-then-undo toast. There is no raw-row
 * restore (`deleteShopPromoCode`'s doc comment: neither `pending` nor
 * `failed` codes ever carry a Stripe promotion-code id, so nothing to
 * reinsert would be redeemable) — this genuinely re-runs Stripe creation with
 * the exact fields the toast carried through the redirect, the same path an
 * ordinary "create a promo" takes.
 */
export async function restorePromoAction(formData: FormData) {
  const { session, allowed, promos } = await requirePromoManager();
  if (!allowed) revalidateAndRedirect(promos, noticeUrl(promos, "not-authorized"));

  const parsed = promoFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(promos, noticeUrl(promos, "restore-failed"));
  const startsAt = parseInstant(formData.get("startsAt"));
  const expiresAt = parseInstant(formData.get("expiresAt"));
  if (startsAt === undefined || expiresAt === undefined) {
    revalidateAndRedirect(promos, noticeUrl(promos, "restore-failed"));
  }

  const outcome = await createShopPromoCode(await getDb(), {
    shopId: session.user.shopId,
    code: parsed.data.code,
    description: parsed.data.description,
    discountPercent: parsed.data.discountPercent,
    scope: parsed.data.scope,
    startsAt,
    expiresAt,
    maxRedemptions: parsed.data.maxRedemptions === "" ? null : parsed.data.maxRedemptions,
    createdByPersonId: session.user.personId,
  });
  revalidateAndRedirect(promos, noticeUrl(promos, outcome.ok ? "restored" : "restore-failed"));
}
