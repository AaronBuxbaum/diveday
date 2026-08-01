import { eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { type ShopCurrency, toShopCurrency } from "@/lib/money";
import type { AccountStatusResult } from "@/lib/payments/connect";
import type { AppDb, DbExecutor } from "./client";
import type { ShopStripeAccount } from "./schema";
import { shopStripeAccounts, shops } from "./schema";

/**
 * The currency this shop charges and displays in — `shops.currency`, the
 * single source of truth (docs ADR 20260731-shop-currency). Every payments
 * path that is about to write a *new* row or call Stripe reads it from here
 * rather than from the connected account, so one shop setting decides what a
 * diver is asked for.
 *
 * Narrowed through `toShopCurrency`, so a row holding something we no longer
 * support reads as the default instead of reaching `Intl` (or Stripe) as
 * garbage. A missing shop reads as the default too: every caller has already
 * resolved the shop by the time it gets here, and a currency lookup is not
 * where a tenant check belongs.
 */
export async function getShopCurrency(db: DbExecutor, shopId: string): Promise<ShopCurrency> {
  const [row] = await db
    .select({ currency: shops.currency })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  return toShopCurrency(row?.currency);
}

/**
 * The two currency codes when the shop's declared currency and the one Stripe
 * reports for its connected account disagree, or null when they don't.
 *
 * `shop_stripe_accounts.default_currency` is advisory: it is what Stripe
 * *reports*, and it never silently overrides what the shop chose. But a
 * mismatch is worth saying out loud, because Stripe will refuse (or settle
 * with an FX conversion the shop didn't ask for) a charge in a currency the
 * connected account can't take. Returns codes, never a sentence — the settings
 * page picks the words (docs ADR 20260731-domain-layer-copy-leaks).
 *
 * Null for a shop with no connected account, or one whose account has not
 * reported a currency yet: there is nothing to disagree with, and warning
 * about it would be noise on a shop that simply hasn't connected Stripe.
 */
export type StripeCurrencyMismatch = {
  /** What the shop declared in settings — what DiveDay will actually charge in. */
  shopCurrency: ShopCurrency;
  /** What Stripe reports the connected account settles in, lowercase. */
  accountCurrency: string;
};

export function stripeCurrencyMismatch(
  shopCurrency: string,
  account: ShopStripeAccount | null,
): StripeCurrencyMismatch | null {
  if (!account || account.disconnectedAt !== null) return null;
  const accountCurrency = account.defaultCurrency?.trim().toLowerCase();
  if (!accountCurrency) return null;
  const declared = toShopCurrency(shopCurrency);
  return accountCurrency === declared ? null : { shopCurrency: declared, accountCurrency };
}

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
  status: {
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    /** Omit to leave the stored currency untouched (e.g. a caller that hasn't read it from Stripe). */
    defaultCurrency?: string;
  },
): Promise<ShopStripeAccount | null> {
  const { defaultCurrency, ...flags } = status;
  const [row] = await db
    .update(shopStripeAccounts)
    .set({ ...flags, ...(defaultCurrency ? { defaultCurrency } : {}), updatedAt: nowDate() })
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
    defaultCurrency: result.account.defaultCurrency,
  });
}
