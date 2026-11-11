import { and, eq, isNull } from "drizzle-orm";
import { canPersonManageShopSettings, loadActiveStaffRoles } from "@/db/authz";
import type { AppDb, DbExecutor } from "@/db/client";
import { queryAll } from "@/db/query-helpers";
import { integrationSyncRecords, orders, shopIntegrations, shops } from "@/db/schema";
import { isStaff } from "@/lib/authz";
import { nowDate, nowMs } from "@/lib/clock";
import { resolveSecretKey, sealSecret } from "@/lib/secret-box";
import {
  listSquareLocations,
  readSquareReceipt,
  refreshSquareToken,
  type SquareConfig,
  type SquareCredentials,
  type SquareReceipt,
  squareConfigFromEnvironment,
  squareId,
} from "./square-api";
import { getShopIntegration, readIntegrationCredentials } from "./store";

const SOURCE = "square_payment_receipt";
const OPERATION = "receipt";
export type SquareReceiptResult =
  | "matched"
  | "not_connected"
  | "unavailable"
  | "invalid"
  | "already_linked"
  | "not_completed"
  | "location_mismatch"
  | "amount_mismatch"
  | "refund_mismatch";

/** A refresh may change credentials only, never reconnect a disconnected/replaced account. */
async function squareAccess(
  db: AppDb,
  shopId: string,
  config: SquareConfig,
  fetchImpl: typeof fetch,
) {
  const row = await getShopIntegration(db, shopId, "square");
  if (!row || row.settings.environment !== config.environment || !row.externalAccountId)
    return null;
  const stored = await readIntegrationCredentials(row);
  if (stored.status !== "ok") return null;
  const value = stored.credentials;
  if (
    typeof value.accessToken !== "string" ||
    typeof value.refreshToken !== "string" ||
    typeof value.expiresAt !== "number" ||
    value.merchantId !== row.externalAccountId
  )
    return null;
  let credentials: SquareCredentials = {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    expiresAt: value.expiresAt,
    merchantId: row.externalAccountId,
  };
  if (credentials.expiresAt <= nowMs() + 5 * 60 * 1000) {
    const renewed = await refreshSquareToken(config, credentials.refreshToken, fetchImpl);
    if (!renewed || renewed.merchantId !== row.externalAccountId) return null;
    const key = resolveSecretKey(undefined);
    if (typeof key === "string") return null;
    const changed = await db
      .update(shopIntegrations)
      .set({ credentialsSealed: sealSecret(JSON.stringify(renewed), key), updatedAt: nowDate() })
      .where(
        and(
          eq(shopIntegrations.id, row.id),
          eq(shopIntegrations.shopId, shopId),
          eq(shopIntegrations.credentialsSealed, row.credentialsSealed),
          isNull(shopIntegrations.deletedAt),
        ),
      )
      .returning({ id: shopIntegrations.id });
    // Another refresh or disconnect won. Retrying starts from its live credential.
    if (changed.length === 0) return null;
    credentials = renewed;
  }
  return { row, credentials };
}

export async function squareLocationsForShop(
  db: AppDb,
  shopId: string,
  personId: string,
  fetchImpl: typeof fetch = fetch,
) {
  if (!(await canPersonManageShopSettings(db, shopId, personId))) return null;
  const config = squareConfigFromEnvironment();
  if (!config) return null;
  const access = await squareAccess(db, shopId, config, fetchImpl);
  if (!access) return null;
  const locations = await listSquareLocations(config, access.credentials.accessToken, fetchImpl);
  const [shop] = await db
    .select({ currency: shops.currency })
    .from(shops)
    .where(eq(shops.id, shopId));
  return (
    locations?.filter(
      (location) =>
        location.merchantId === access.row.externalAccountId &&
        location.currency === shop?.currency,
    ) ?? null
  );
}

export async function chooseSquareLocation(
  db: AppDb,
  input: { shopId: string; personId: string; locationId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (
    !squareId.safeParse(input.locationId).success ||
    !(await canPersonManageShopSettings(db, input.shopId, input.personId))
  )
    return false;
  const config = squareConfigFromEnvironment();
  if (!config) return false;
  const access = await squareAccess(db, input.shopId, config, fetchImpl);
  if (!access) return false;
  const locations = await listSquareLocations(config, access.credentials.accessToken, fetchImpl);
  const [shop] = await db
    .select({ currency: shops.currency, isDemo: shops.isDemo })
    .from(shops)
    .where(eq(shops.id, input.shopId));
  const location = locations?.find(
    (candidate) =>
      candidate.id === input.locationId &&
      candidate.merchantId === access.row.externalAccountId &&
      candidate.currency === shop?.currency,
  );
  if (!location || !shop || shop.isDemo) return false;
  const changed = await db
    .update(shopIntegrations)
    .set({
      settings: {
        ...access.row.settings,
        squareLocationId: location.id,
        squareLocationName: location.name,
      },
      updatedAt: nowDate(),
    })
    .where(
      and(
        eq(shopIntegrations.id, access.row.id),
        eq(shopIntegrations.shopId, input.shopId),
        eq(shopIntegrations.externalAccountId, location.merchantId),
        isNull(shopIntegrations.deletedAt),
      ),
    )
    .returning({ id: shopIntegrations.id });
  return changed.length === 1;
}

export function squareReceiptMatch(
  receipt: SquareReceipt,
  order: {
    totalCents: number;
    refundedCents: number;
    currency: string;
    counterReceipt?: { tipCents: number } | null;
  },
  locationId: string,
): SquareReceiptResult {
  if (receipt.status !== "COMPLETED") return "not_completed";
  if (receipt.locationId !== locationId) return "location_mismatch";
  if (
    receipt.currency !== order.currency ||
    receipt.totalCents !== order.totalCents ||
    receipt.tipCents !== (order.counterReceipt?.tipCents ?? 0)
  )
    return "amount_mismatch";
  if (receipt.refundedCents !== order.refundedCents) return "refund_mismatch";
  return "matched";
}

export async function getSquareReceiptState(db: DbExecutor, shopId: string, orderId: string) {
  const [connection, links] = await queryAll(db, [
    () => getShopIntegration(db, shopId, "square"),
    async () =>
      db
        .select({
          evidence: integrationSyncRecords.receiptEvidence,
          checkedAt: integrationSyncRecords.updatedAt,
          lastError: integrationSyncRecords.lastError,
        })
        .from(integrationSyncRecords)
        .where(
          and(
            eq(integrationSyncRecords.shopId, shopId),
            eq(integrationSyncRecords.provider, "square"),
            eq(integrationSyncRecords.sourceType, SOURCE),
            eq(integrationSyncRecords.sourceId, orderId),
            eq(integrationSyncRecords.operation, OPERATION),
          ),
        )
        .limit(1),
  ]);
  const config = squareConfigFromEnvironment();
  return {
    connected: Boolean(
      connection &&
        connection.settings.environment === config?.environment &&
        connection.settings.squareLocationId,
    ),
    link: links.length > 0 ? links[0] : null,
  };
}

/** Evidence only: never writes an order balance or collection ledger entry. */
export async function linkSquareReceipt(
  db: AppDb,
  input: { shopId: string; personId: string; orderId: string; paymentId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SquareReceiptResult> {
  const roles = await loadActiveStaffRoles(db, input.shopId, input.personId);
  if (!roles || !isStaff(roles) || !squareId.safeParse(input.paymentId).success) return "invalid";
  const [shop] = await db
    .select({ isDemo: shops.isDemo })
    .from(shops)
    .where(eq(shops.id, input.shopId));
  const [candidate] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.shopId, input.shopId), eq(orders.id, input.orderId)));
  if (
    !shop ||
    shop.isDemo ||
    !candidate ||
    candidate.stripeInvoiceId ||
    !["cash", "card_machine", "bank_transfer", "other"].includes(candidate.collection) ||
    !["paid", "partly_refunded", "refunded"].includes(candidate.status)
  )
    return "invalid";
  const config = squareConfigFromEnvironment();
  if (!config) return "not_connected";
  const access = await squareAccess(db, input.shopId, config, fetchImpl);
  if (!access?.row.settings.squareLocationId) return "not_connected";
  const receipt = await readSquareReceipt(
    config,
    access.credentials.accessToken,
    input.paymentId,
    fetchImpl,
  );
  if (!receipt) return "unavailable";
  const merchantId = access.row.externalAccountId as string;
  const externalId = `${config.environment}:${merchantId}:${receipt.paymentId}`;
  return db.transaction(async (tx): Promise<SquareReceiptResult> => {
    const [live] = await tx
      .select()
      .from(shopIntegrations)
      .where(
        and(
          eq(shopIntegrations.shopId, input.shopId),
          eq(shopIntegrations.id, access.row.id),
          isNull(shopIntegrations.deletedAt),
        ),
      )
      .for("update");
    if (
      !live ||
      live.externalAccountId !== merchantId ||
      live.settings.environment !== config.environment ||
      live.settings.squareLocationId !== access.row.settings.squareLocationId
    )
      return "not_connected";
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.shopId, input.shopId), eq(orders.id, input.orderId)))
      .for("update");
    if (
      !order ||
      order.stripeInvoiceId ||
      !["paid", "partly_refunded", "refunded"].includes(order.status)
    )
      return "invalid";
    const where = and(
      eq(integrationSyncRecords.shopId, input.shopId),
      eq(integrationSyncRecords.provider, "square"),
      eq(integrationSyncRecords.sourceType, SOURCE),
      eq(integrationSyncRecords.sourceId, input.orderId),
      eq(integrationSyncRecords.operation, OPERATION),
    );
    const [existing] = await tx.select().from(integrationSyncRecords).where(where);
    if (existing && existing.externalId !== externalId) return "already_linked";
    const outcome = squareReceiptMatch(receipt, order, live.settings.squareLocationId as string);
    const evidence = { ...receipt, environment: config.environment, merchantId };
    if (existing) {
      await tx
        .update(integrationSyncRecords)
        .set({
          receiptEvidence: evidence,
          lastError: outcome === "matched" ? null : outcome,
          updatedAt: nowDate(),
          ...(outcome === "matched" ? { lastSyncedAt: nowDate() } : {}),
        })
        .where(where);
      return outcome;
    }
    if (outcome !== "matched") return outcome;
    const inserted = await tx
      .insert(integrationSyncRecords)
      .values({
        shopId: input.shopId,
        provider: "square",
        sourceType: SOURCE,
        sourceId: input.orderId,
        operation: OPERATION,
        externalId,
        receiptEvidence: evidence,
      })
      .onConflictDoNothing()
      .returning({ id: integrationSyncRecords.id });
    return inserted.length ? "matched" : "already_linked";
  });
}

/** Delete the active association, retaining its evidence/history; never delete the purchase. */
export async function releaseSquareReceipt(
  db: AppDb,
  input: { shopId: string; personId: string; orderId: string; paymentId: string },
): Promise<boolean> {
  const roles = await loadActiveStaffRoles(db, input.shopId, input.personId);
  if (!roles || !isStaff(roles)) return false;
  return db.transaction(async (tx) => {
    const where = and(
      eq(integrationSyncRecords.shopId, input.shopId),
      eq(integrationSyncRecords.provider, "square"),
      eq(integrationSyncRecords.sourceType, SOURCE),
      eq(integrationSyncRecords.sourceId, input.orderId),
      eq(integrationSyncRecords.operation, OPERATION),
    );
    const [link] = await tx.select().from(integrationSyncRecords).where(where).for("update");
    if (!link) return true;
    // An old form cannot delete a replacement link.
    if (link.receiptEvidence?.paymentId !== input.paymentId) return false;
    await tx
      .update(integrationSyncRecords)
      .set({ operation: `released:${link.id}`, updatedAt: nowDate() })
      .where(where);
    return true;
  });
}
