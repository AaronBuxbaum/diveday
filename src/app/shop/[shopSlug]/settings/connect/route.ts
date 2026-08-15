import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { canPersonManagePaymentSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { publicAppUrl } from "@/lib/notifications";
import {
  connectProviderFromEnvironment,
  STRIPE_CONNECT_STATE_COOKIE,
  stripeConnectCallbackUrl,
} from "@/lib/payments/connect";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

/**
 * Kicks off Standard Stripe Connect OAuth: a random state nonce goes into a
 * short-lived httpOnly cookie and as the OAuth `state` param, so the callback
 * can reject a forged redirect (docs ADR 20260719-stripe-connect-orders).
 */
export async function GET(request: Request) {
  const session = await requireStaffSession();
  const settingsUrl = new URL(shopPath(session.user.shopSlug, "settings"), request.url);

  // Connecting the shop's Stripe account is a payment setting — owner/manager
  // only (H-14, ADR 20260724-role-authorization), re-checked against live roles.
  const canPayments = await canPersonManagePaymentSettings(
    await getDb(),
    session.user.shopId,
    session.user.personId,
  );
  if (!canPayments) {
    settingsUrl.searchParams.set("notice", "not-authorized");
    return NextResponse.redirect(settingsUrl);
  }

  const appHost = publicAppUrl();
  if (!appHost) {
    settingsUrl.searchParams.set("notice", "not-configured");
    return NextResponse.redirect(settingsUrl);
  }

  const provider = connectProviderFromEnvironment();
  const redirectUri = stripeConnectCallbackUrl(appHost);
  const state = crypto.randomUUID();
  const authorizeUrl = provider.authorizeUrl({ redirectUri, state });
  if (!authorizeUrl) {
    settingsUrl.searchParams.set("notice", "not-configured");
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
