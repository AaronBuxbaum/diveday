"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parseForm } from "@/features/platform/form-parse";
import { getAuth } from "@/lib/auth";
import { safeShopReturnPath, shopPath } from "@/lib/staff-notices";

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

/**
 * Where a signed-in staffer lands: the page the edge bounced them from when it
 * is inside their own shop (`safeShopReturnPath` refuses another origin,
 * another shop and traversal), else their shop's home, else `/shop`.
 */
function landingPath(shopSlug: string | null | undefined, formData: FormData): string {
  if (!shopSlug) return "/shop";
  const callback = formData.get("callbackUrl");
  return (
    safeShopReturnPath(shopSlug, typeof callback === "string" ? callback : null) ??
    shopPath(shopSlug)
  );
}

/** A refusal's sign-in URL, still carrying the page the staffer was headed to. */
function signInPath(error: string, formData: FormData): string {
  const callback = formData.get("callbackUrl");
  const query = new URLSearchParams({ error });
  if (typeof callback === "string" && callback.startsWith("/shop/"))
    query.set("callbackUrl", callback);
  return `/sign-in?${query}`;
}

export async function authenticate(formData: FormData) {
  // A form that is not three strings is a wrong password, said the same way.
  const parsed = parseForm(signInForm, formData);
  if (!parsed.ok) redirect(signInPath("1", formData));
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
      redirect(signInPath("1", formData));
    }
    throw error;
  }
  if (pendingSignIn) redirect(signInPath("two-factor", formData));
  // Outside the try: this redirect must never be caught as a refusal. Straight
  // to the shop the sign-in resolved on the server, so the address bar names
  // it and the edge's `/shop` hop is not paid; `/shop` only when the session
  // names no shop. A `callbackUrl` is honoured only as a path inside that shop.
  redirect(landingPath(shopSlug, formData));
}

/** The code step accepts no account identity or password. */
export async function confirmSignIn(formData: FormData) {
  const code = formData.get("totpCode");
  const auth = await getAuth();
  const result = await auth.api.completeDiveDaySignIn({
    body: { totpCode: typeof code === "string" ? code : "" },
    headers: await headers(),
  });
  if (result.status === "invalid_code") redirect(signInPath("invalid-code", formData));
  if (result.status === "rate_limited") redirect(signInPath("rate-limit", formData));
  if (result.status !== "signed_in") redirect(signInPath("restart", formData));
  redirect(landingPath(result.shopSlug, formData));
}

export async function cancelSignIn() {
  const auth = await getAuth();
  await auth.api.cancelDiveDaySignIn({ headers: await headers() });
  redirect("/sign-in");
}
