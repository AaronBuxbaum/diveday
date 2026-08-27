"use server";

import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { sendFindMyBookingLinks } from "@/db/find-my-booking";
import { joinLastMinuteList } from "@/db/last-minute-list";
import { getShopBySlug } from "@/db/shops";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import {
  declarationWithinPersonBudget,
  diveDeclarationInput,
  diveDeclarationSchema,
  toDiveDeclaration,
} from "@/lib/dive-declaration";
import { publicAppUrl } from "@/lib/notifications";
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
    // (src/db/self-declared-cards.ts). Bounded per *subject* address rather
    // than per IP, which is the only key a rotating set of submitters cannot
    // clear; an exhausted budget drops the claim and lets the sign-up through.
    declaration: await declarationWithinPersonBudget(
      declaration.success ? toDiveDeclaration(declaration.data) : undefined,
      { shopId: shop.id, email: parsed.data.email },
    ),
  });
  return { success: true };
}

const findMyBookingSchema = z.object({ email: diverEmailSchema });

export type FindMyBookingFormState = { success?: boolean };

/**
 * "Can't find your link?" (issue #723) — the public way back into a booking
 * whose confirmation never arrived. Every diver surface past the moment of
 * booking is a bearer token from an email (`/ready/[token]`,
 * `/waivers/[token]`, `/recap/[token]`, `/claim/[token]`); this re-issues one.
 *
 * **The response never varies with whether the address has a booking.**
 * Always the identical `{ success: true }`, on the identical code path,
 * whether the email matches or not — the same shape `requestPasswordReset`
 * (`forgot-password/actions.ts`) uses for the same reason: an anonymous
 * capability-minting endpoint that answered differently would be an
 * account-enumeration oracle. A well-formed email does the identical fixed
 * work — resolve the shop, check the per-IP limiter, schedule `after()` —
 * whether it is throttled, matches, or does not, so a throttled request is
 * not measurably cheaper than an allowed one (`security-reviewer`, issue
 * #723). Only a malformed email short-circuits earlier, the same shape
 * `requestPasswordReset` accepts: it costs no DB read either way, so it
 * leaks nothing about the database.
 *
 * **Only the per-IP limiter is checked here.** The per-*inbox*
 * (`findMyBookingByEmail`) limiter is checked inside `sendFindMyBookingLinks`
 * itself, once it has decided real work is pending — see that function's own
 * doc comment for why checking it here, unconditionally, would let anyone who
 * merely knows an address drain that diver's own recovery budget.
 *
 * The actual work — deciding which bookings exist and mailing them —
 * happens in `sendFindMyBookingLinks`, `after()`-deferred past the response
 * so a match is never measurably slower than a miss.
 */
export async function requestFindMyBookingAction(
  shopSlug: string,
  _prev: FindMyBookingFormState,
  formData: FormData,
): Promise<FindMyBookingFormState> {
  const parsed = findMyBookingSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { success: true };
  const email = parsed.data.email.trim().toLowerCase();

  const dbi = await getDb();
  const [shop, ip] = await Promise.all([getShopBySlug(dbi, shopSlug), clientIp()]);
  const origin = publicAppUrl();
  const byIp = await checkRateLimit(
    rateLimitKey("find-my-booking-ip", ip),
    RATE_LIMITS.findMyBookingByIp,
  );

  // Always scheduled, matched or not, throttled or not — only what happens
  // inside varies, and that happens after the response is already sent.
  after(() => {
    if (byIp.allowed && shop && origin) {
      sendFindMyBookingLinks(dbi, { shopId: shop.id, email, origin }).catch(() => {});
    }
  });
  return { success: true };
}
