import { NextResponse } from "next/server";
import { canPersonManageShopSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import {
  consumeIntegrationOAuthState,
  exchangeXeroCode,
  fetchXeroTenant,
  getShopIntegration,
  INTEGRATION_PROVIDER_REGISTRY,
  integrationCallbackUrl,
  saveShopIntegration,
  xeroConfigFromEnvironment,
} from "@/features/integrations";
import { publicAppUrl } from "@/lib/notifications";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

function destination(request: Request, slug: string, notice: string) {
  const url = new URL(shopPath(slug, "settings", "integrations"), request.url);
  url.searchParams.set("notice", notice);
  return url;
}

export async function GET(request: Request) {
  const session = await requireStaffSession();
  const url = new URL(request.url);
  const db = await getDb();
  const allowed = await canPersonManageShopSettings(db, session.user.shopId, session.user.personId);
  if (!allowed)
    return NextResponse.redirect(destination(request, session.user.shopSlug, "not-authorized"));
  const state = url.searchParams.get("state");
  if (!state) return NextResponse.redirect(destination(request, session.user.shopSlug, "failed"));
  const context = await consumeIntegrationOAuthState(db, { state, provider: "xero" });
  if (
    !context ||
    context.shopId !== session.user.shopId ||
    context.personId !== session.user.personId
  ) {
    return NextResponse.redirect(destination(request, session.user.shopSlug, "failed"));
  }
  const shop = await getShopById(db, session.user.shopId);
  if (!shop || shop.isDemo) {
    return NextResponse.redirect(destination(request, session.user.shopSlug, "failed"));
  }
  if (url.searchParams.get("error") || !url.searchParams.get("code")) {
    return NextResponse.redirect(destination(request, session.user.shopSlug, "failed"));
  }
  const config = xeroConfigFromEnvironment();
  const appHost = publicAppUrl();
  if (!config || !appHost)
    return NextResponse.redirect(destination(request, session.user.shopSlug, "not-configured"));
  const result = await exchangeXeroCode({
    config,
    code: url.searchParams.get("code") as string,
    redirectUri: integrationCallbackUrl(appHost, "xero"),
  });
  if (result.status !== "connected")
    return NextResponse.redirect(destination(request, session.user.shopSlug, "failed"));
  // Xero's token says nothing about which organisation it reaches, so the
  // tenant is read before the connection is written: a row with no tenant id
  // could never make a single call and would sit in Settings looking connected.
  const tenant = await fetchXeroTenant(result.credentials);
  if (tenant.status !== "ok")
    return NextResponse.redirect(destination(request, session.user.shopSlug, "failed"));
  try {
    const existing = await getShopIntegration(db, session.user.shopId, "xero");
    await saveShopIntegration(db, {
      shopId: session.user.shopId,
      provider: "xero",
      credentials: result.credentials,
      externalAccountId: tenant.tenantId,
      externalLabel: tenant.tenantName,
      settings: {
        ...existing?.settings,
        eventTypes: [...INTEGRATION_PROVIDER_REGISTRY.xero.eventTypes],
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "failed";
    return NextResponse.redirect(
      destination(
        request,
        session.user.shopSlug,
        code === "encryption_key_unset" || code === "encryption_key_invalid"
          ? code.replaceAll("_", "-")
          : "failed",
      ),
    );
  }
  return NextResponse.redirect(destination(request, session.user.shopSlug, "connected"));
}
