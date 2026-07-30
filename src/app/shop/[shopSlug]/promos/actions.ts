"use server";

import { z } from "zod";
import { canPersonManagePaymentSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { createShopPromoCode, setShopPromoEnabled } from "@/db/shop-promos";
import { revalidateAndRedirect } from "@/lib/navigation";
import { PROMO_DISCOUNT_MAX, PROMO_DISCOUNT_MIN } from "@/lib/promo-codes";
import { requireStaffSession } from "@/lib/session";

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
  return { session, allowed, promos: `/shop/${session.user.shopSlug}/promos` };
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
  if (!allowed) revalidateAndRedirect(promos, `${promos}?notice=not_authorized`);

  const parsed = promoFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) revalidateAndRedirect(promos, `${promos}?notice=invalid`);
  const startsAt = parseInstant(formData.get("startsAt"));
  const expiresAt = parseInstant(formData.get("expiresAt"));
  if (startsAt === undefined || expiresAt === undefined) {
    revalidateAndRedirect(promos, `${promos}?notice=invalid`);
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
  revalidateAndRedirect(promos, `${promos}?notice=${outcome.ok ? "created" : outcome.reason}`);
}

export async function setPromoEnabledAction(formData: FormData) {
  const { session, allowed, promos } = await requirePromoManager();
  if (!allowed) revalidateAndRedirect(promos, `${promos}?notice=not_authorized`);

  const promoId = String(formData.get("promoId") ?? "");
  const enable = formData.get("enable") === "true";
  if (!promoId) revalidateAndRedirect(promos, `${promos}?notice=invalid`);
  const changed = await setShopPromoEnabled(await getDb(), session.user.shopId, promoId, enable);
  revalidateAndRedirect(
    promos,
    `${promos}?notice=${changed ? (enable ? "enabled" : "disabled") : "invalid"}`,
  );
}
