"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { listPackagesOnSale } from "@/db/dive-packages";
import { createDiverPackageOrder } from "@/db/orders";
import { getShopBySlug } from "@/db/shops";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/**
 * The refusal, and what the diver typed: React resets a form after its action
 * runs, so a refusal that did not hand the answers back would make the diver
 * type their name and email again to retry.
 */
export type PackagePurchaseState = {
  error?: string;
  name?: string;
  email?: string;
  packageId?: string;
};

const purchaseSchema = z.object({
  packageId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200),
});

/**
 * A diver buys one dive package from the shop's public pages.
 *
 * `shopSlug` is bound on the page, but a bound argument travels with the
 * request like any other, so a caller can name any shop: that is fine, because
 * every shop's packages page is public and the shop is only ever the one the
 * slug resolves to. What a caller cannot steer is the package or its price.
 * The package is looked up again here and again inside
 * `createDiverPackageOrder`, and its price is the row's, so nothing the visitor
 * posts can change what is billed. A raised invoice sends the diver straight to Stripe's hosted page;
 * Stripe's `invoice.paid` webhook then grants the dives through the same
 * `grantPackageEntitlementsForPaidOrder` a staff-raised invoice uses.
 */
export async function buyPackageAction(
  shopSlug: string,
  _prev: PackagePurchaseState,
  formData: FormData,
): Promise<PackagePurchaseState> {
  const typed = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value.slice(0, 200) : undefined;
  };
  const { error } = await purchase(shopSlug, formData);
  return { error, name: typed("name"), email: typed("email"), packageId: typed("packageId") };
}

async function purchase(shopSlug: string, formData: FormData): Promise<{ error: string }> {
  const t = diverTranslator(await requestLocale());
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("package-purchase", ip), RATE_LIMITS.packagePurchaseByIp))
      .allowed
  ) {
    return { error: t("common.rateLimited") };
  }

  const parsed = purchaseSchema.safeParse({
    packageId: formData.get("packageId"),
    name: formData.get("name"),
    email: formData.get("email"),
  });
  if (!parsed.success) return { error: t("packages.error.invalid") };
  const email = parsed.data.email.trim().toLowerCase();

  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) return { error: t("packages.error.notOnSale") };
  // Per shop and email: a global bucket would let tapping Buy at one shop
  // spend a diver's tries at every other.
  if (
    !(
      await checkRateLimit(
        rateLimitKey("package-purchase-email", shop.id, email),
        RATE_LIMITS.packagePurchaseByEmail,
      )
    ).allowed
  ) {
    return { error: t("common.rateLimited") };
  }
  const pkg = (await listPackagesOnSale(db, shop.id)).find(
    (row) => row.id === parsed.data.packageId,
  );
  if (!pkg) return { error: t("packages.error.notOnSale") };

  const result = await createDiverPackageOrder(db, {
    shopId: shop.id,
    packageId: pkg.id,
    fullName: parsed.data.name,
    email,
    lineDescription: t("packages.invoiceLine", { packageName: pkg.name, count: pkg.diveCount }),
  });
  if (result.ok) {
    const url = result.order.hostedInvoiceUrl;
    // Only ever off to Stripe's own https page; anything else is a failure to
    // say so, never a redirect to wherever a stored string points.
    if (url?.startsWith("https://")) redirect(url);
    return { error: t("packages.error.failed") };
  }
  switch (result.reason) {
    case "not_on_sale":
      return { error: t("packages.error.notOnSale") };
    case "not_connected":
    case "tax_location_required":
      return { error: t("packages.error.unavailable", { shopName: shop.name }) };
    case "invalid":
      return { error: t("packages.error.invalid") };
    case "stripe_failed":
      return { error: t("packages.error.failed") };
  }
}
