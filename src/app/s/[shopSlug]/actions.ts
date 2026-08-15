"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import { joinLastMinuteList } from "@/db/last-minute-list";
import { getShopBySlug } from "@/db/shops";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import {
  diveDeclarationInput,
  diveDeclarationSchema,
  toDiveDeclaration,
} from "@/lib/dive-declaration";
import { diverEmailSchema, diverNameSchema, diverPhoneSchema } from "@/lib/person-fields";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

const joinSchema = z.object({
  // Shared diver person-field bounds (src/lib/person-fields.ts).
  fullName: diverNameSchema,
  email: diverEmailSchema,
  phone: diverPhoneSchema.optional(),
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
  // Resolved here, not passed back as a code: this state reaches
  // LastMinuteListForm.tsx straight off `useActionState`, with no Server
  // Component render in between to translate it first.
  const t = diverTranslator(await requestLocale());
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("last-minute-list", ip), RATE_LIMITS.lastMinuteListJoin))
      .allowed
  ) {
    return { error: t("common.rateLimited") };
  }

  const parsed = joinSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
    availableFrom: formData.get("availableFrom") || undefined,
    availableUntil: formData.get("availableUntil") || undefined,
  });
  // Parsed apart from the identity fields on purpose: the "what can you dive?"
  // pair is optional, so a level code that fails validation is *not said* — it
  // must never be the reason a sign-up is refused (src/lib/dive-declaration.ts).
  const declaration = diveDeclarationSchema.safeParse(diveDeclarationInput(formData));
  if (!parsed.success) return { error: t("lastMinute.errors.invalid") };
  if (
    parsed.data.availableFrom &&
    parsed.data.availableUntil &&
    parsed.data.availableFrom > parsed.data.availableUntil
  ) {
    return { error: t("lastMinute.errors.dateRange") };
  }

  const dbi = await getDb();
  const shop = await getShopBySlug(dbi, shopSlug);
  if (!shop) return { error: t("lastMinute.errors.shopUnavailable") };

  await joinLastMinuteList(dbi, {
    shopId: shop.id,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone,
    availableFrom: parsed.data.availableFrom,
    availableUntil: parsed.data.availableUntil,
    // Recorded against the resolved person as a self-declared pending card, and
    // shown to staff before a blast goes out — never used to filter one
    // (src/db/self-declared-cards.ts).
    declaration: declaration.success ? toDiveDeclaration(declaration.data) : undefined,
  });
  return { success: true };
}
