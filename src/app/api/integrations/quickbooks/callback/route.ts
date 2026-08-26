import { NextResponse } from "next/server";
import { canPersonManageShopSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import {
  consumeIntegrationOAuthState,
  exchangeQuickBooksCode,
  getShopIntegration,
  INTEGRATION_PROVIDER_REGISTRY,
  integrationCallbackUrl,
  quickBooksConfigFromEnvironment,
  saveShopIntegration,
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
  const context = await consumeIntegrationOAuthState(db, { state, provider: "quickbooks" });
  if (
    !context ||
    context.shopId !== session.user.shopId ||
    context.personId !== session.user.personId
  ) {
    return NextResponse.redirect(destination(request, session.user.shopSlug, "failed"));
  }
  const shop = await getShopById(db, session.user.shopId);
  const realmId = url.searchParams.get("realmId")?.trim();
  if (!shop || shop.isDemo || !realmId || !/^\d{1,32}$/.test(realmId)) {
    return NextResponse.redirect(destination(request, session.user.shopSlug, "failed"));
  }
  if (url.searchParams.get("error") || !url.searchParams.get("code")) {
    return NextResponse.redirect(destination(request, session.user.shopSlug, "failed"));
  }
  const config = quickBooksConfigFromEnvironment();
  const appHost = publicAppUrl();
  if (!config || !appHost)
    return NextResponse.redirect(destination(request, session.user.shopSlug, "not-configured"));
  const result = await exchangeQuickBooksCode({
    config,
    code: url.searchParams.get("code") as string,
    redirectUri: integrationCallbackUrl(appHost, "quickbooks"),
  });
  if (result.status !== "connected")
    return NextResponse.redirect(destination(request, session.user.shopSlug, "failed"));
  try {
    const existing = await getShopIntegration(db, session.user.shopId, "quickbooks");
    await saveShopIntegration(db, {
      shopId: session.user.shopId,
      provider: "quickbooks",
      credentials: result.credentials,
      externalAccountId: realmId,
      externalLabel: `QuickBooks ${realmId}`,
      settings: {
        ...existing?.settings,
        environment: config.environment,
        eventTypes: [...INTEGRATION_PROVIDER_REGISTRY.quickbooks.eventTypes],
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
