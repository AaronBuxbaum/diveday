import { NextResponse } from "next/server";
import { canPersonManageShopSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import {
  consumeIntegrationOAuthState,
  exchangeShopifyCode,
  saveShopIntegration,
  shopifyConfigFromEnvironment,
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
  const context = await consumeIntegrationOAuthState(db, { state, provider: "shopify" });
  if (
    !context ||
    context.shopId !== session.user.shopId ||
    context.personId !== session.user.personId ||
    !context.context.shopDomain
  ) {
    return NextResponse.redirect(destination(request, session.user.shopSlug, "failed"));
  }

  const shop = await getShopById(db, session.user.shopId);
  if (!shop || shop.isDemo)
    return NextResponse.redirect(destination(request, session.user.shopSlug, "failed"));
  if (url.searchParams.get("error") || !url.searchParams.get("code")) {
    return NextResponse.redirect(destination(request, session.user.shopSlug, "failed"));
  }
  const config = shopifyConfigFromEnvironment();
  if (!config || !publicAppUrl()) {
    return NextResponse.redirect(destination(request, session.user.shopSlug, "not-configured"));
  }
  const result = await exchangeShopifyCode({
    config,
    shopDomain: context.context.shopDomain,
    code: url.searchParams.get("code") as string,
  });
  if (result.status !== "connected") {
    return NextResponse.redirect(destination(request, session.user.shopSlug, "failed"));
  }
  try {
    await saveShopIntegration(db, {
      shopId: session.user.shopId,
      provider: "shopify",
      credentials: result.credentials,
      externalAccountId: result.credentials.shopDomain,
      externalLabel: result.credentials.shopDomain,
      settings: { shopDomain: result.credentials.shopDomain, eventTypes: [] },
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
