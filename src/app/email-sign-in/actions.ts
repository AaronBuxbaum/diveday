"use server";
import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { sendMagicSignInMail } from "@/features/email-sign-in";
import { getAuth } from "@/lib/auth";
import { publicAppUrl } from "@/lib/notifications";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { shopPath } from "@/lib/staff-notices";

export async function requestMagicSignIn(formData: FormData) {
  const parsed = z.string().trim().email().max(150).safeParse(formData.get("email"));
  if (parsed.success) {
    const email = parsed.data.toLowerCase();
    const ip = await clientIp();
    const limits = await Promise.all([
      checkRateLimit(rateLimitKey("magic-sign-in-ip", ip), RATE_LIMITS.passwordResetRequestByIp),
      checkRateLimit(
        rateLimitKey("magic-sign-in-email", email),
        RATE_LIMITS.passwordResetRequestByEmail,
      ),
    ]);
    const origin = publicAppUrl();
    if (limits.every((limit) => limit.allowed) && origin)
      after(async () => {
        await sendMagicSignInMail(await getDb(), email);
      });
  }
  redirect("/email-sign-in?sent=1");
}

/** GET renders a confirmation only. Email scanners cannot spend a link or create a session. */
export async function redeemMagicSignIn(formData: FormData) {
  const token = formData.get("token");
  if (typeof token !== "string") redirect("/email-sign-in?error=1");
  let result: Awaited<
    ReturnType<Awaited<ReturnType<typeof getAuth>>["api"]["signInDiveDayMagicLink"]>
  >;
  try {
    result = await (await getAuth()).api.signInDiveDayMagicLink({
      body: { token },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) redirect("/email-sign-in?error=1");
    throw error;
  }
  if (result.pending) redirect("/sign-in?error=two-factor");
  redirect(result.shopSlug ? shopPath(result.shopSlug) : "/shop");
}
