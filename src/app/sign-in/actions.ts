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
});

export async function authenticate(formData: FormData) {
  // A form that is not three strings is a wrong password, said the same way.
  const parsed = parseForm(signInForm, formData);
  if (!parsed.ok) redirect("/sign-in?error=1");
  const { email, password } = parsed.data;
  let shopSlug: string | null;
  let pendingSignIn = false;
  try {
    const auth = await getAuth();
    const signedIn = await auth.api.signInDiveDayCredentials({
      body: {
        email,
        password,
      },
      headers: await headers(),
    });
    pendingSignIn = signedIn.pending;
    shopSlug = signedIn.shopSlug;
  } catch (error) {
    if (error instanceof APIError) {
      redirect("/sign-in?error=1");
    }
    throw error;
  }
  if (pendingSignIn) redirect("/sign-in?error=two-factor");
  // Outside the try: this redirect must never be caught as a refusal. Straight
  // to the shop the sign-in resolved on the server, so the address bar names
  // it and the edge's `/shop` hop is not paid; `/shop` only when the session
  // names no shop. Never `callbackUrl`, or any other request-supplied target.
  redirect(shopSlug ? shopPath(shopSlug) : "/shop");
}

/** The code step accepts no account identity or password. */
export async function confirmSignIn(formData: FormData) {
  const code = formData.get("totpCode");
  const auth = await getAuth();
  const result = await auth.api.completeDiveDaySignIn({
    body: { totpCode: typeof code === "string" ? code : "" },
    headers: await headers(),
  });
  if (result.status === "invalid_code") redirect("/sign-in?error=invalid-code");
  if (result.status === "rate_limited") redirect("/sign-in?error=rate-limit");
  if (result.status !== "signed_in") redirect("/sign-in?error=restart");
  redirect(result.shopSlug ? shopPath(result.shopSlug) : "/shop");
}

export async function cancelSignIn() {
  const auth = await getAuth();
  await auth.api.cancelDiveDaySignIn({ headers: await headers() });
  redirect("/sign-in");
}
