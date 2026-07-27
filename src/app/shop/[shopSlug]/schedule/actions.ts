"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import { joinLastMinuteList } from "@/db/last-minute-list";
import { getShopBySlug } from "@/db/shops";
import { checkRateLimit, RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

const joinSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  phone: z.string().trim().max(30).optional(),
  availableFrom: z.string().optional(),
  availableUntil: z.string().optional(),
});

export type LastMinuteListFormState = { error?: string; success?: boolean };

/**
 * Public, shop-wide opt-in: "tell me about last-minute deals" — distinct from
 * the per-trip wait list (docs ADR 20260727-last-minute-fill-promos). Never
 * checks capacity or a specific trip; it's a standing preference a diver can
 * update anytime by submitting again.
 */
export async function joinLastMinuteListAction(
  shopSlug: string,
  _prev: LastMinuteListFormState,
  formData: FormData,
): Promise<LastMinuteListFormState> {
  const ip = await clientIp();
  if (
    !checkRateLimit(rateLimitKey("last-minute-list", ip), RATE_LIMITS.lastMinuteListJoin).allowed
  ) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const parsed = joinSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
    availableFrom: formData.get("availableFrom") || undefined,
    availableUntil: formData.get("availableUntil") || undefined,
  });
  if (!parsed.success) return { error: "Enter a name and a valid email." };
  if (
    parsed.data.availableFrom &&
    parsed.data.availableUntil &&
    parsed.data.availableFrom > parsed.data.availableUntil
  ) {
    return { error: "The end date has to be on or after the start date." };
  }

  const dbi = await getDb();
  const shop = await getShopBySlug(dbi, shopSlug);
  if (!shop) return { error: "This shop isn't available right now." };

  await joinLastMinuteList(dbi, {
    shopId: shop.id,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone,
    availableFrom: parsed.data.availableFrom,
    availableUntil: parsed.data.availableUntil,
  });
  return { success: true };
}
