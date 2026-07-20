import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "@/db/stripe-accounts";
import { publicAppUrl } from "@/lib/notifications";
import { connectProviderFromEnvironment } from "@/lib/payments/connect";
import { requireStaffSession } from "@/lib/session";
import { STRIPE_CONNECT_STATE_COOKIE } from "../connect/route";

/** Stripe's OAuth redirect target: verifies state, exchanges the code, and stores the connected account. */
export async function GET(request: Request) {
  const session = await requireStaffSession();
  const settingsUrl = new URL(`/shop/${session.user.shopSlug}/settings/payments`, request.url);
  const url = new URL(request.url);

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STRIPE_CONNECT_STATE_COOKIE)?.value;
  cookieStore.delete(STRIPE_CONNECT_STATE_COOKIE);

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (error || !code || !state || !expectedState || state !== expectedState) {
    settingsUrl.searchParams.set("notice", "connect_failed");
    return NextResponse.redirect(settingsUrl);
  }

  const appHost = publicAppUrl();
  if (!appHost) {
    settingsUrl.searchParams.set("notice", "not_configured");
    return NextResponse.redirect(settingsUrl);
  }

  const provider = connectProviderFromEnvironment();
  const redirectUri = `${appHost}/shop/${session.user.shopSlug}/settings/payments/callback`;
  const result = await provider.exchangeCode(code, redirectUri);
  if (result.status !== "connected") {
    settingsUrl.searchParams.set("notice", "connect_failed");
    return NextResponse.redirect(settingsUrl);
  }

  const db = await getDb();
  await upsertShopStripeAccount(db, session.user.shopId, result.stripeAccountId);
  const status = await provider.retrieveAccountStatus(result.stripeAccountId);
  if (status.status === "ok") {
    await setShopStripeAccountStatus(db, result.stripeAccountId, {
      chargesEnabled: status.account.chargesEnabled,
      payoutsEnabled: status.account.payoutsEnabled,
      detailsSubmitted: status.account.detailsSubmitted,
    });
  }

  settingsUrl.searchParams.set("notice", "connected");
  return NextResponse.redirect(settingsUrl);
}
