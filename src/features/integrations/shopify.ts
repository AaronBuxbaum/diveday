import { and, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import {
  getIntegrationSyncRecord,
  getShopIntegration,
  markIntegrationHealthy,
  readIntegrationCredentials,
  upsertIntegrationSyncRecord,
} from "@/db/integrations";
import { divePackages, type IntegrationCredentials, shops } from "@/db/schema";
import { minorToMajor, toShopCurrency } from "@/lib/money";
import { type RentalPricing, toRentableKinds } from "@/lib/rentals";

export const SHOPIFY_API_VERSION = "2026-07";

/**
 * A per-request ceiling on every outbound call.
 *
 * The dispatcher drains up to 50 deliveries in one sequential pass inside a
 * 300-second cron, and `fetch` has no default timeout: one endpoint that
 * accepts a connection and never answers holds the whole outbox until the
 * function is killed, and every delivery behind it stays due. A hung request
 * is a failure that retries, not a queue that stops.
 */
const REQUEST_TIMEOUT_MS = 15_000;
export const SHOPIFY_OAUTH_SCOPES = ["write_products"] as const;

export type ShopifyConfig = {
  clientId: string;
  clientSecret: string;
  apiVersion: string;
};

export type ShopifyCredentials = {
  accessToken: string;
  shopDomain: string;
  scope?: string;
};

export type ShopifyCatalogItem = {
  sourceType: "rental" | "package";
  sourceId: string;
  title: string;
  description: string;
  priceCents: number;
};

export function shopifyConfigFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ShopifyConfig | null {
  const clientId = env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = env.SHOPIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    apiVersion: env.SHOPIFY_API_VERSION?.trim() || SHOPIFY_API_VERSION,
  };
}

/** Shopify's OAuth host must be the shop's canonical myshopify.com domain. */
export function normalizeShopifyDomain(value: string): string | null {
  const domain = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain) ? domain : null;
}

export function shopifyAuthorizationUrl(input: {
  config: ShopifyConfig;
  shopDomain: string;
  state: string;
  redirectUri: string;
}): string {
  const shopDomain = normalizeShopifyDomain(input.shopDomain);
  if (!shopDomain) throw new Error("invalid_shopify_domain");
  const url = new URL(`https://${shopDomain}/admin/oauth/authorize`);
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("scope", SHOPIFY_OAUTH_SCOPES.join(","));
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

export async function exchangeShopifyCode(
  input: {
    config: ShopifyConfig;
    shopDomain: string;
    code: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<
  { status: "connected"; credentials: ShopifyCredentials } | { status: "failed"; code: string }
> {
  const shopDomain = normalizeShopifyDomain(input.shopDomain);
  if (!shopDomain) return { status: "failed", code: "invalid_shopify_domain" };
  let response: Response;
  try {
    response = await fetchImpl(`https://${shopDomain}/admin/oauth/access_token`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: input.config.clientId,
        client_secret: input.config.clientSecret,
        code: input.code,
      }),
    });
  } catch {
    return { status: "failed", code: "shopify_exchange_unavailable" };
  }
  if (!response.ok) return { status: "failed", code: "shopify_exchange_refused" };
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const accessToken = typeof body?.access_token === "string" ? body.access_token : null;
  if (!accessToken) return { status: "failed", code: "shopify_exchange_invalid" };
  return {
    status: "connected",
    credentials: {
      accessToken,
      shopDomain,
      scope: typeof body?.scope === "string" ? body.scope : undefined,
    },
  };
}

type GraphqlResponse = {
  data?: Record<string, unknown>;
  errors?: Array<{ message?: string }>;
};

function credentialString(credentials: IntegrationCredentials, key: string): string | null {
  const value = credentials[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function shopifyGraphql(
  input: {
    credentials: ShopifyCredentials;
    apiVersion: string;
    query: string;
    variables?: Record<string, unknown>;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: "ok"; data: Record<string, unknown> } | { status: "failed"; code: string }> {
  const response = await fetchImpl(
    `https://${input.credentials.shopDomain}/admin/api/${input.apiVersion}/graphql.json`,
    {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-shopify-access-token": input.credentials.accessToken,
      },
      body: JSON.stringify({ query: input.query, variables: input.variables ?? {} }),
    },
  ).catch(() => null);
  if (!response) return { status: "failed", code: "shopify_api_unavailable" };
  if (!response.ok) return { status: "failed", code: "shopify_api_refused" };
  const body = (await response.json().catch(() => null)) as GraphqlResponse | null;
  if (!body?.data || body.errors?.length)
    return { status: "failed", code: "shopify_graphql_error" };
  return { status: "ok", data: body.data };
}

export function shopifyProductSetVariables(
  item: ShopifyCatalogItem,
  currency: string,
  externalId?: string | null,
): Record<string, unknown> {
  const productSet: Record<string, unknown> = {
    title: item.title,
    descriptionHtml: `<p>${escapeHtml(item.description)}</p>`,
    vendor: "DiveDay",
    productType: "DiveDay catalog",
    status: "ACTIVE",
    tags: ["diveday-managed", item.sourceType],
    variants: [{ price: minorToMajor(item.priceCents, currency) }],
  };
  return {
    ...(externalId ? { identifier: { id: externalId } } : {}),
    synchronous: true,
    productSet: productSet,
  };
}

const PRODUCT_SET_MUTATION = `
  mutation SyncDiveDayProduct($productSet: ProductSetInput!, $synchronous: Boolean!, $identifier: ProductSetIdentifiers) {
    productSet(input: $productSet, synchronous: $synchronous, identifier: $identifier) {
      product { id }
      userErrors { field message }
    }
  }
`;

function asShopifyCredentials(credentials: IntegrationCredentials): ShopifyCredentials | null {
  const accessToken = credentialString(credentials, "accessToken");
  const shopDomain = credentialString(credentials, "shopDomain");
  return accessToken && shopDomain ? { accessToken, shopDomain } : null;
}

function rentalTitle(kind: string): string {
  return `Rental: ${kind.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}`;
}

export function buildShopifyCatalog(input: {
  rentalItems: readonly string[];
  rentalPricing: RentalPricing;
  packages: readonly { id: string; name: string; priceCents: number; diveCount: number }[];
}): ShopifyCatalogItem[] {
  const pricing = input.rentalPricing;
  const catalog: ShopifyCatalogItem[] = [];
  for (const kind of toRentableKinds(input.rentalItems)) {
    const priceCents = pricing.perItemCents[kind as keyof typeof pricing.perItemCents];
    if (typeof priceCents !== "number") continue;
    catalog.push({
      sourceType: "rental",
      sourceId: kind,
      title: rentalTitle(kind),
      description: `DiveDay rental catalog item: ${kind.replaceAll("_", " ")}.`,
      priceCents,
    });
  }
  if (pricing.setCents !== null) {
    catalog.push({
      sourceType: "rental",
      sourceId: "core-set",
      title: "Rental: Core set",
      description: "DiveDay rental catalog item: core equipment set.",
      priceCents: pricing.setCents,
    });
  }
  if (pricing.nitroxCents !== null && input.rentalItems.includes("nitrox")) {
    catalog.push({
      sourceType: "rental",
      sourceId: "nitrox",
      title: "Nitrox fill",
      description: "DiveDay rental catalog item: nitrox fill.",
      priceCents: pricing.nitroxCents,
    });
  }
  for (const item of input.packages) {
    catalog.push({
      sourceType: "package",
      sourceId: item.id,
      title: item.name,
      description: `${item.diveCount}-dive package managed by DiveDay.`,
      priceCents: item.priceCents,
    });
  }
  return catalog;
}

export async function syncShopifyCatalog(
  db: DbExecutor,
  shopId: string,
  config: ShopifyConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ synced: number }> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
  const integration = await getShopIntegration(db, shopId, "shopify");
  if (!shop || !integration) throw new Error("shopify_not_connected");
  const stored = await readIntegrationCredentials(integration);
  if (stored.status !== "ok") throw new Error(`shopify_${stored.status}`);
  const credentials = asShopifyCredentials(stored.credentials);
  if (!credentials) throw new Error("shopify_invalid_credentials");
  const packages = await db
    .select({
      id: divePackages.id,
      name: divePackages.name,
      priceCents: divePackages.priceCents,
      diveCount: divePackages.diveCount,
    })
    .from(divePackages)
    .where(and(eq(divePackages.shopId, shopId), isNull(divePackages.deletedAt)));
  const catalog = buildShopifyCatalog({
    rentalItems: shop.rentalItems,
    rentalPricing: shop.rentalPricing,
    packages,
  });
  let synced = 0;
  const currency = toShopCurrency(shop.currency);
  for (const item of catalog) {
    const record = await getIntegrationSyncRecord(db, {
      shopId: integration.shopId,
    provider: integration.provider,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      operation: "catalog_product",
    });
    const variables = shopifyProductSetVariables(item, currency, record?.externalId);
    const result = await shopifyGraphql(
      {
        credentials,
        apiVersion: config.apiVersion,
        query: PRODUCT_SET_MUTATION,
        variables,
      },
      fetchImpl,
    );
    if (result.status !== "ok") throw new Error(result.code);
    const productSet = result.data.productSet as
      | { product?: { id?: string }; userErrors?: unknown[] }
      | undefined;
    const externalId = productSet?.product?.id;
    if (typeof externalId !== "string" || productSet?.userErrors?.length) {
      throw new Error("shopify_product_sync_failed");
    }
    await upsertIntegrationSyncRecord(db, {
      shopId: integration.shopId,
    provider: integration.provider,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      operation: "catalog_product",
      externalId,
    });
    synced += 1;
  }
  await markIntegrationHealthy(db, integration.id);
  return { synced };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
