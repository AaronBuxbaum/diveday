import { eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AccountStatusResult } from "@/lib/payments/connect";
import type { AppDb, DbExecutor } from "./client";
import type { ShopStripeAccount } from "./schema";
import { shopStripeAccounts } from "./schema";

export async function getShopStripeAccount(
  db: DbExecutor,
  shopId: string,
): Promise<ShopStripeAccount | null> {
  const [row] = await db
    .select()
    .from(shopStripeAccounts)
    .where(eq(shopStripeAccounts.shopId, shopId))
    .limit(1);
  return row ?? null;
}

export async function getShopStripeAccountByAccountId(
  db: DbExecutor,
  stripeAccountId: string,
): Promise<ShopStripeAccount | null> {
  const [row] = await db
    .select()
    .from(shopStripeAccounts)
    .where(eq(shopStripeAccounts.stripeAccountId, stripeAccountId))
    .limit(1);
  return row ?? null;
}

/** One row per shop: a reconnect after a disconnect replaces the prior account id. */
export async function upsertShopStripeAccount(
  db: AppDb,
  shopId: string,
  stripeAccountId: string,
): Promise<ShopStripeAccount> {
  const values = {
    shopId,
    stripeAccountId,
    connectedAt: nowDate(),
    disconnectedAt: null,
    updatedAt: nowDate(),
  };
  const [row] = await db
    .insert(shopStripeAccounts)
    .values(values)
    .onConflictDoUpdate({ target: shopStripeAccounts.shopId, set: values })
    .returning();
  if (!row) throw new Error("upsertShopStripeAccount: insert returned no row");
  return row;
}

export async function setShopStripeAccountStatus(
  db: AppDb,
  stripeAccountId: string,
  status: { chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean },
): Promise<ShopStripeAccount | null> {
  const [row] = await db
    .update(shopStripeAccounts)
    .set({ ...status, updatedAt: nowDate() })
    .where(eq(shopStripeAccounts.stripeAccountId, stripeAccountId))
    .returning();
  return row ?? null;
}

export async function disconnectShopStripeAccount(
  db: AppDb,
  stripeAccountId: string,
): Promise<ShopStripeAccount | null> {
  const [row] = await db
    .update(shopStripeAccounts)
    .set({
      disconnectedAt: nowDate(),
      chargesEnabled: false,
      payoutsEnabled: false,
      updatedAt: nowDate(),
    })
    .where(eq(shopStripeAccounts.stripeAccountId, stripeAccountId))
    .returning();
  return row ?? null;
}

/**
 * Fail-closed readiness for creating an order: connected, not since
 * disconnected, and Stripe reports charges as currently enabled.
 */
export function canAcceptPayments(account: ShopStripeAccount | null): boolean {
  return !!account && account.disconnectedAt === null && account.chargesEnabled;
}

/** Refresh stored account flags from a live Stripe lookup; a failed lookup leaves the stored row untouched. */
export async function refreshShopStripeAccountStatus(
  db: AppDb,
  stripeAccountId: string,
  result: AccountStatusResult,
): Promise<ShopStripeAccount | null> {
  if (result.status !== "ok") return getShopStripeAccountByAccountId(db, stripeAccountId);
  return setShopStripeAccountStatus(db, stripeAccountId, {
    chargesEnabled: result.account.chargesEnabled,
    payoutsEnabled: result.account.payoutsEnabled,
    detailsSubmitted: result.account.detailsSubmitted,
  });
}
