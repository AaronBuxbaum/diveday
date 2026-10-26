"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { parseForm } from "@/lib/form-parse";
import { shopPath } from "@/lib/staff-notices";

// Rate limiting lives in the custom credentials plugin's endpoint handler
// (src/lib/auth.ts), not here — it runs for every credentials attempt
// regardless of entry path (this page's action, or a direct POST to
// /api/auth/sign-in/diveday-credentials, if a route ever mounts the handler),
// so it is the one chokepoint that can't be bypassed. A check here too would
// double-consume the same budget (CR-013).
const signInForm = z.object({
  email: z.string().default(""),
  password: z.string().default(""),
  totpCode: z.string().default(""),
});

export async function authenticate(formData: FormData) {
  // A form that is not three strings is a wrong password, said the same way.
  const parsed = parseForm(signInForm, formData);
  if (!parsed.ok) redirect("/sign-in?error=1");
  const { email, password, totpCode } = parsed.data;
  let shopSlug: string | null;
  try {
    const auth = await getAuth();
    const signedIn = await auth.api.signInDiveDayCredentials({
      body: {
        email,
        password,
        totpCode: totpCode.trim() || undefined,
      },
      headers: await headers(),
    });
    shopSlug = signedIn.shopSlug;
  } catch (error) {
    if (error instanceof APIError) {
      if (error.message === "invalid_two_factor") redirect("/sign-in?error=invalid-code");
      if (error.message === "two_factor_required") {
        redirect("/sign-in?error=two-factor");
      }
      redirect("/sign-in?error=1");
    }
    throw error;
  }
  // Outside the try: this redirect must never be caught as a refusal. Straight
  // to the shop the sign-in resolved on the server, so the address bar names
  // it and the edge's `/shop` hop is not paid; `/shop` only when the session
  // names no shop. Never `callbackUrl`, or any other request-supplied target.
  redirect(shopSlug ? shopPath(shopSlug) : "/shop");
}
