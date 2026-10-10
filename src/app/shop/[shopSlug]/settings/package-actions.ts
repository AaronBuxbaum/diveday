"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { createDivePackage, deleteDivePackage } from "@/db/dive-packages";
import { maxLineItemUnitAmountCents } from "@/db/orders";
import { getShopCurrency } from "@/db/stripe-accounts";
import { validateDivePackage } from "@/lib/dive-packages";
import { majorToMinor, toShopCurrency } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { paymentSettingsBlock, settingsBlock } from "./action-helpers";

/**
 * Add a prepaid dive package to the shop's price list
 * (ADR 20260822-a-package-is-entitlements-not-money).
 *
 * Behind `paymentSettingsBlock` like every other price on this page: a package
 * is what the shop charges, and `canManagePaymentSettings`'s own docstring
 * names pricing as what it gates.
 */
export async function createDivePackageAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "promos", "packages");
  await settingsBlock(session);
  await paymentSettingsBlock(session);
  const db = await getDb();
  // The shop's own currency decides the multiplier, the same way every other
  // price box on this page is read — 5000 in a JPY shop is ¥5,000.
  const currency = toShopCurrency(await getShopCurrency(db, session.user.shopId));
  const validUntilRaw = String(formData.get("validUntil") ?? "").trim();
  const validated = validateDivePackage({
    name: String(formData.get("name") ?? ""),
    diveCount: Number(formData.get("diveCount")),
    priceCents: majorToMinor(Number(formData.get("priceDollars")), currency),
    scope: formData.get("scope") === "fun_dives" ? "fun_dives" : "all",
    maxPriceCents: maxLineItemUnitAmountCents(currency),
    // Blank means "never lapses"; otherwise the shop chooses an inclusive
    // calendar date rather than a purchase-time duration.
    validUntil: validUntilRaw === "" ? null : validUntilRaw,
  });
  if (!validated.ok) {
    redirect(noticeUrl(page, "package-invalid"));
  }
  await createDivePackage(db, {
    shopId: session.user.shopId,
    createdByPersonId: session.user.personId,
    ...validated.value,
  });
  revalidateAndRedirect(page, noticeUrl(page, "package-saved"));
}

/**
 * Stop selling one. Soft, and here that is load-bearing rather than
 * conventional: the dives somebody already bought reference this row and must
 * outlive it.
 */
export async function deleteDivePackageAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "promos", "packages");
  await settingsBlock(session);
  await paymentSettingsBlock(session);
  // `uuidParam`, like `deleteBoatAction` two hundred lines down: a malformed id
  // reaches `eq(divePackages.id, $1)` against a uuid column, Postgres raises
  // 22P02, and the owner gets an unhandled 500 where a refusal belongs
  // (`security-reviewer`, issue #706).
  const packageId = uuidParam(String(formData.get("packageId") ?? ""));
  if (!packageId) {
    redirect(noticeUrl(page, "package-invalid"));
  }
  // Deliberately the same notice whether or not a row matched: a cross-tenant
  // id must not be distinguishable from a real one.
  await deleteDivePackage(await getDb(), session.user.shopId, packageId);
  revalidateAndRedirect(page, noticeUrl(page, "package-deleted"));
}
