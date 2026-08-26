"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonManageShopSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import {
  createIntegrationOAuthState,
  disconnectShopIntegration,
  getShopIntegration,
  INTEGRATION_PROVIDER_REGISTRY,
  integrationCallbackUrl,
  normalizeZapierEventTypes,
  normalizeZapierWebhookUrl,
  quickBooksAuthorizationUrl,
  quickBooksConfigFromEnvironment,
  readIntegrationCredentials,
  saveShopIntegration,
  sendZapierTest,
  shopifyAuthorizationUrl,
  shopifyConfigFromEnvironment,
  syncShopifyCatalog,
  updateShopIntegrationSettings,
} from "@/features/integrations";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { secretKeyFromEnvironment } from "@/lib/secret-box";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

type Notice =
  | "connected"
  | "saved"
  | "disconnected"
  | "sync-complete"
  | "test-sent"
  | "invalid"
  | "not-configured"
  | "not-authorized"
  | "failed"
  | "encryption-key-unset"
  | "encryption-key-invalid";

const shopifyDomainSchema = z.object({
  shopDomain: z.string().trim().min(1).max(120),
});

async function integrationContext() {
  const session = await requireStaffSession();
  const db = await getDb();
  const path = shopPath(session.user.shopSlug, "settings", "integrations");
  const allowed = await canPersonManageShopSettings(db, session.user.shopId, session.user.personId);
  if (!allowed) redirect(noticeUrl(shopPath(session.user.shopSlug), "integrations-not-authorized"));
  return { db, session, path };
}

function secureStorageNotice(): "encryption-key-unset" | "encryption-key-invalid" | null {
  const result = secretKeyFromEnvironment();
  if (result.status === "ok") return null;
  return result.status === "unset" ? "encryption-key-unset" : "encryption-key-invalid";
}

function done(
  path: string,
  notice: Notice,
  extra?: Record<string, string | number | undefined>,
): never {
  revalidateAndRedirect(path, noticeUrl(path, notice, extra));
}

export async function startShopifyConnectionAction(formData: FormData): Promise<void> {
  const { db, session, path } = await integrationContext();
  const parsed = shopifyDomainSchema.safeParse({ shopDomain: formData.get("shopDomain") ?? "" });
  const config = shopifyConfigFromEnvironment();
  const appHost = publicAppUrl();
  if (!parsed.success || !config || !appHost || secureStorageNotice())
    done(path, !parsed.success ? "invalid" : "not-configured");
  const state = await createIntegrationOAuthState(db, {
    shopId: session.user.shopId,
    personId: session.user.personId,
    provider: "shopify",
    context: { shopDomain: parsed.data.shopDomain },
  });
  redirect(
    shopifyAuthorizationUrl({
      config,
      shopDomain: parsed.data.shopDomain,
      state,
      redirectUri: integrationCallbackUrl(appHost, "shopify"),
    }),
  );
}

export async function startQuickBooksConnectionAction(): Promise<void> {
  const { db, session, path } = await integrationContext();
  const config = quickBooksConfigFromEnvironment();
  const appHost = publicAppUrl();
  const storageNotice = secureStorageNotice();
  if (!config || !appHost || storageNotice) done(path, storageNotice ?? "not-configured");
  const state = await createIntegrationOAuthState(db, {
    shopId: session.user.shopId,
    personId: session.user.personId,
    provider: "quickbooks",
  });
  redirect(
    quickBooksAuthorizationUrl({
      config,
      state,
      redirectUri: integrationCallbackUrl(appHost, "quickbooks"),
    }),
  );
}

export async function saveZapierIntegrationAction(formData: FormData): Promise<void> {
  const { db, session, path } = await integrationContext();
  const url = normalizeZapierWebhookUrl(String(formData.get("webhookUrl") ?? ""));
  const eventTypes = normalizeZapierEventTypes(
    formData.getAll("eventType").filter((value): value is string => typeof value === "string"),
  );
  const storageNotice = secureStorageNotice();
  if (!url || eventTypes.length === 0) done(path, "invalid");
  if (storageNotice) done(path, storageNotice);
  try {
    await saveShopIntegration(db, {
      shopId: session.user.shopId,
      provider: "zapier",
      credentials: { webhookUrl: url },
      externalLabel: "Zapier Catch Hook",
      settings: { eventTypes },
    });
  } catch {
    done(path, "failed");
  }
  done(path, "connected");
}

export async function updateZapierEventsAction(formData: FormData): Promise<void> {
  const { db, session, path } = await integrationContext();
  const eventTypes = normalizeZapierEventTypes(
    formData.getAll("eventType").filter((value): value is string => typeof value === "string"),
  );
  if (eventTypes.length === 0) done(path, "invalid");
  const row = await getShopIntegration(db, session.user.shopId, "zapier");
  if (!row) done(path, "failed");
  await updateShopIntegrationSettings(db, {
    shopId: session.user.shopId,
    provider: "zapier",
    settings: { ...row.settings, eventTypes },
  });
  done(path, "saved");
}

export async function updateQuickBooksSettingsAction(formData: FormData): Promise<void> {
  const { db, session, path } = await integrationContext();
  const incomeAccountId = String(formData.get("incomeAccountId") ?? "").trim();
  if (incomeAccountId && !/^\d{1,32}$/.test(incomeAccountId)) done(path, "invalid");
  const row = await getShopIntegration(db, session.user.shopId, "quickbooks");
  if (!row) done(path, "failed");
  await updateShopIntegrationSettings(db, {
    shopId: session.user.shopId,
    provider: "quickbooks",
    settings: {
      ...row.settings,
      eventTypes: [...INTEGRATION_PROVIDER_REGISTRY.quickbooks.eventTypes],
      ...(incomeAccountId ? { incomeAccountId } : {}),
    },
  });
  done(path, "saved");
}

export async function syncShopifyCatalogAction(): Promise<void> {
  const { db, session, path } = await integrationContext();
  const config = shopifyConfigFromEnvironment();
  if (!config) done(path, "not-configured");
  try {
    const result = await syncShopifyCatalog(db, session.user.shopId, config);
    done(path, "sync-complete", { count: result.synced });
  } catch {
    done(path, "failed");
  }
}

export async function testZapierIntegrationAction(): Promise<void> {
  const { db, session, path } = await integrationContext();
  const row = await getShopIntegration(db, session.user.shopId, "zapier");
  if (!row) done(path, "failed");
  const stored = await readIntegrationCredentials(row);
  if (stored.status !== "ok" || typeof stored.credentials.webhookUrl !== "string")
    done(path, "failed");
  const result = await sendZapierTest(stored.credentials.webhookUrl as string, session.user.shopId);
  done(path, result.status === "sent" ? "test-sent" : "failed");
}

export async function disconnectIntegrationAction(formData: FormData): Promise<void> {
  const { db, session, path } = await integrationContext();
  const provider = formData.get("provider");
  if (provider !== "shopify" && provider !== "quickbooks" && provider !== "zapier")
    done(path, "invalid");
  await disconnectShopIntegration(db, session.user.shopId, provider);
  done(path, "disconnected");
}
