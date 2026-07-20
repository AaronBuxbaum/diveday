import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { publicAppUrl } from "@/lib/notifications";
import { connectProviderFromEnvironment } from "@/lib/payments/connect";
import { requireStaffSession } from "@/lib/session";

/**
 * Kicks off Standard Stripe Connect OAuth: a random state nonce goes into a
 * short-lived httpOnly cookie and as the OAuth `state` param, so the callback
 * can reject a forged redirect (docs ADR 20260719-stripe-connect-orders).
 */
export const STRIPE_CONNECT_STATE_COOKIE = "stripe_connect_state";

export async function GET(request: Request) {
  const session = await requireStaffSession();
  const settingsUrl = new URL(`/shop/${session.user.shopSlug}/settings/payments`, request.url);

  const appHost = publicAppUrl();
  if (!appHost) {
    settingsUrl.searchParams.set("notice", "not_configured");
    return NextResponse.redirect(settingsUrl);
  }

  const provider = connectProviderFromEnvironment();
  const redirectUri = `${appHost}/shop/${session.user.shopSlug}/settings/payments/callback`;
  const state = crypto.randomUUID();
  const authorizeUrl = provider.authorizeUrl({ redirectUri, state });
  if (!authorizeUrl) {
    settingsUrl.searchParams.set("notice", "not_configured");
    return NextResponse.redirect(settingsUrl);
  }

  const cookieStore = await cookies();
  cookieStore.set(STRIPE_CONNECT_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl);
}
