import { NextResponse } from "next/server";
import { canPersonManageShopSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import {
  consumeIntegrationOAuthState,
  exchangeSquareCode,
  integrationCallbackUrl,
  recordShopIntegration,
  squareConfigFromEnvironment,
} from "@/features/integrations";
import { requireStaffSession } from "@/features/session";
import { publicAppUrl } from "@/lib/notifications";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

export async function GET(request: Request) {
  const session = await requireStaffSession();
  const db = await getDb();
  const destination = (notice: string) =>
    NextResponse.redirect(
      new URL(
        noticeUrl(shopPath(session.user.shopSlug, "settings", "integrations"), notice),
        request.url,
      ),
    );
  if (!(await canPersonManageShopSettings(db, session.user.shopId, session.user.personId)))
    return destination("not-authorized");
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (!state) return destination("failed");
  const context = await consumeIntegrationOAuthState(db, { state, provider: "square" });
  const config = squareConfigFromEnvironment();
  const appHost = publicAppUrl();
  if (
    !context ||
    context.shopId !== session.user.shopId ||
    context.personId !== session.user.personId ||
    context.context.environment !== config?.environment
  )
    return destination("failed");
  const shop = await getShopById(db, session.user.shopId);
  const code = url.searchParams.get("code");
  if (!shop || shop.isDemo || !code || code.length > 191 || url.searchParams.has("error"))
    return destination("failed");
  if (!config || !appHost) return destination("not-configured");
  const credentials = await exchangeSquareCode({
    config,
    code,
    redirectUri: integrationCallbackUrl(appHost, "square"),
  });
  if (!credentials) return destination("failed");
  try {
    // Reconnecting requires choosing a location again. Never retain a location from another merchant.
    await recordShopIntegration(db, {
      shopId: shop.id,
      provider: "square",
      credentials,
      externalAccountId: credentials.merchantId,
      externalLabel: "Square",
      settings: { environment: config.environment, eventTypes: [] },
    });
  } catch {
    return destination("failed");
  }
  return destination("connected");
}
