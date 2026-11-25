"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { sendDiverSignInMail } from "@/features/accounts/diver-sign-in";
import { publicSignInPath } from "@/lib/public-routes";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/**
 * Asks for a diver's sign-in link (ADR 20261125-diver-sign-in). Every outcome
 * lands on the same "check your email" page, mail or no mail,
 * so the page never says whether an address is on file. The send runs after
 * the response, so its timing says nothing either.
 */
export async function requestDiverSignIn(shopSlug: string, formData: FormData) {
  const parsed = z.string().trim().email().max(150).safeParse(formData.get("email"));
  const sentPath = `${publicSignInPath(shopSlug)}?sent=1`;
  if (!parsed.success) redirect(sentPath);
  const email = parsed.data.toLowerCase();
  const ip = await clientIp();
  const limits = await Promise.all([
    checkRateLimit(rateLimitKey("diver-sign-in-ip", ip), RATE_LIMITS.passwordResetRequestByIp),
    checkRateLimit(
      rateLimitKey("diver-sign-in-email", `${shopSlug}:${email}`),
      RATE_LIMITS.passwordResetRequestByEmail,
    ),
  ]);
  // A refusal is answered like a send: a stranger typing someone's address
  // over and over learns nothing, and mails nobody.
  if (limits.every((limit) => limit.allowed)) {
    after(async () => {
      const db = await getDb();
      const shop = await getShopBySlug(db, shopSlug);
      if (shop) await sendDiverSignInMail(db, { shop, email });
    });
  }
  redirect(sentPath);
}
