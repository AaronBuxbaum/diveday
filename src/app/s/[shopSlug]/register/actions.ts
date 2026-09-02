"use server";

import { after } from "next/server";
import { z } from "zod";

import { getDb } from "@/db/client";
import { deliverSelfRegistrationWaiver, registerDiverAtShop } from "@/db/self-registration";
import { getShopBySlug } from "@/db/shops";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import {
  hasContactPath,
  SELF_DECLARED_LEVELS,
  SELF_REGISTRATION_DONE,
  type SelfRegistrationFormState,
} from "@/lib/self-registration";

const registrationSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.email().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  agency: z.enum(["padi", "ssi", "naui", "sdi", "raid", "bsac", "cmas", "other"]).optional(),
  level: z.enum(SELF_DECLARED_LEVELS).optional(),
  identifier: z.string().trim().max(120).optional(),
  wetsuitSize: z.string().trim().max(40).optional(),
  bootSize: z.string().trim().max(40).optional(),
  finSize: z.string().trim().max(40).optional(),
});

export type { SelfRegistrationFormState };

/**
 * **The counter's QR, submitted** (issue #1236).
 *
 * `shopSlug` is bound server-side from the page's own URL param, never taken
 * from the form — the discipline every public write on this namespace uses.
 *
 * ### Every failure here is about the submission, never about the person
 *
 * A missing name, an unreadable email, a rate limit, a shop that does not
 * exist: those the visitor may see. "We already have you" and "your answers
 * need a doctor" they may not, because an anonymous visitor who could tell
 * those apart could type any address and learn who dives with this shop
 * (`src/lib/self-registration.ts`).
 *
 * So there is exactly one success return, and `registerDiverAtShop` gives this
 * action nothing else to branch on even if a future edit wanted to.
 *
 * ### Three buckets, and the order between them matters
 *
 * Per **IP** catches one visitor spraying addresses, and it is checked first so
 * that a request the wide net was going to refuse never spends a shop token.
 * Per **shop** is what stops a QR card in a busy lobby — or one determined
 * visitor — from being every other shop's problem: a single global bucket would
 * let one counter starve the rest. Both key on the *slug*, before any database
 * read, so a flood costs a hash rather than a query. Per **recipient address**
 * is the third, and unlike the other two an empty bucket drops the *send* and
 * keeps the registration.
 */
export async function registerAtShopAction(
  shopSlug: string,
  _prev: SelfRegistrationFormState,
  formData: FormData,
): Promise<SelfRegistrationFormState> {
  const t = diverTranslator(await requestLocale());
  const ip = await clientIp();
  // **The wide net first, and only then the shop's own bucket.** Spending a
  // shop token on a request the IP bucket was going to refuse is what let one
  // address drain a counter's 120/hr allowance and leave a real walk-in
  // throttled — the exact denial the shop bucket exists to prevent
  // (`security-reviewer`, #1236). Every other paired bucket in
  // `src/lib/rate-limit.ts` goes this way round for the same reason.
  if (
    !(await checkRateLimit(rateLimitKey("self-register-ip", ip), RATE_LIMITS.selfRegisterByIp))
      .allowed
  ) {
    return { error: t("common.rateLimited") };
  }
  if (
    !(
      await checkRateLimit(
        rateLimitKey("self-register-shop", shopSlug),
        RATE_LIMITS.selfRegisterByShop,
      )
    ).allowed
  ) {
    return { error: t("common.rateLimited") };
  }

  const parsed = registrationSchema.safeParse({
    fullName: formData.get("fullName") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    agency: formData.get("agency") || undefined,
    level: formData.get("level") || undefined,
    identifier: formData.get("identifier") || undefined,
    wetsuitSize: formData.get("wetsuitSize") || undefined,
    bootSize: formData.get("bootSize") || undefined,
    finSize: formData.get("finSize") || undefined,
  });
  if (!parsed.success) return { error: t("register.invalid") };
  if (!hasContactPath(parsed.data)) return { error: t("register.contactRequired") };

  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) return { error: t("register.unavailable") };

  // The third bucket, keyed on the address being *written to* rather than the
  // one submitting: without it, ten submissions an hour aimed at one inbox is
  // ten waiver emails an hour with this shop's name on them, and an attacker
  // can point the shop's own sender at strangers. An empty bucket drops the
  // send and keeps the registration: a mail-bombing bucket must never become
  // a registration-blocking one.
  const email = parsed.data.email?.trim().toLowerCase() ?? null;
  const mayDeliverWaiver =
    email === null ||
    (
      await checkRateLimit(
        rateLimitKey("self-register-email", shop.id, email),
        RATE_LIMITS.selfRegisterEmailByRecipient,
      )
    ).allowed;

  const { personId } = await registerDiverAtShop(db, {
    shopId: shop.id,
    fullName: parsed.data.fullName,
    // Null for a phone-only walk-in, who is deliberately never matched — see
    // `SelfRegistrationInput.email`.
    email,
    phone: parsed.data.phone,
    certification:
      parsed.data.agency && parsed.data.level
        ? {
            agency: parsed.data.agency,
            level: parsed.data.level,
            identifier: parsed.data.identifier,
          }
        : undefined,
    fit:
      parsed.data.wetsuitSize || parsed.data.bootSize || parsed.data.finSize
        ? {
            wetsuitSize: parsed.data.wetsuitSize,
            bootSize: parsed.data.bootSize,
            finSize: parsed.data.finSize,
          }
        : undefined,
  });

  // **Delivery happens after the visitor already has their answer.** A new
  // diver's release is a real SES round trip; a returning diver whose release
  // still stands sends nothing at all. Left on the request path that gap is a
  // measurable person-enumeration oracle — the one thing this page is shaped to
  // deny — so both submissions return on the same work
  // (`deliverSelfRegistrationWaiver`, `security-reviewer` #1236). A stalled or
  // failed send must never reach the visitor either; the shop sees the pending
  // release on its own surfaces.
  if (mayDeliverWaiver) {
    after(async () => {
      await deliverSelfRegistrationWaiver(await getDb(), { shopId: shop.id, personId }).catch(
        () => undefined,
      );
    });
  }

  return { status: SELF_REGISTRATION_DONE };
}
