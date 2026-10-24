"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { createDivePackage, deleteDivePackage } from "@/db/dive-packages";
import { maxLineItemUnitAmountCents } from "@/db/orders";
import { shopHasFeatureOn } from "@/db/shops";
import { getShopCurrency } from "@/db/stripe-accounts";
import { validateDivePackage } from "@/lib/dive-packages";
import { formValue, readForm, text, trimmedText } from "@/lib/form-parse";
import { majorToMinor, toShopCurrency } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { paymentSettingsBlock, settingsBlock } from "./action-helpers";

const packageForm = z.object({
  validUntil: trimmedText(),
  name: text(),
  diveCount: formValue(),
  priceDollars: formValue(),
  scope: formValue(),
});
const packageIdForm = z.object({ packageId: text() });

/**
 * Dive packages switched off (the Features page): the post lands on
 * Discounts, and so does a hand-built post, having changed no price.
 */
async function packagesOn(shopId: string, page: string) {
  if (!(await shopHasFeatureOn(await getDb(), shopId, "divePackages"))) {
    revalidateAndRedirect(page);
  }
}

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
  // Packages are a section of Promos (visual review 2026-10-24, A26).
  const page = shopPath(session.user.shopSlug, "promos");
  const section = `${page}#dive-packages`;
  await settingsBlock(session);
  await paymentSettingsBlock(session);
  await packagesOn(session.user.shopId, page);
  const db = await getDb();
  // The shop's own currency decides the multiplier, the same way every other
  // price box on this page is read — 5000 in a JPY shop is ¥5,000.
  const currency = toShopCurrency(await getShopCurrency(db, session.user.shopId));
  const form = readForm(packageForm, formData);
  const validUntilRaw = form.validUntil;
  const validated = validateDivePackage({
    name: form.name,
    diveCount: Number(form.diveCount),
    priceCents: majorToMinor(Number(form.priceDollars), currency),
    scope: form.scope === "fun_dives" ? "fun_dives" : "all",
    maxPriceCents: maxLineItemUnitAmountCents(currency),
    // Blank means "never lapses"; otherwise the shop chooses an inclusive
    // calendar date rather than a purchase-time duration.
    validUntil: validUntilRaw === "" ? null : validUntilRaw,
  });
  if (!validated.ok) {
    redirect(noticeUrl(section, "package-invalid"));
  }
  await createDivePackage(db, {
    shopId: session.user.shopId,
    createdByPersonId: session.user.personId,
    ...validated.value,
  });
  revalidateAndRedirect(page, noticeUrl(section, "package-saved"));
}

/**
 * Stop selling one. Soft, and here that is load-bearing rather than
 * conventional: the dives somebody already bought reference this row and must
 * outlive it.
 */
export async function deleteDivePackageAction(formData: FormData) {
  const session = await requireStaffSession();
  // Packages are a section of Promos (visual review 2026-10-24, A26).
  const page = shopPath(session.user.shopSlug, "promos");
  const section = `${page}#dive-packages`;
  await settingsBlock(session);
  await paymentSettingsBlock(session);
  await packagesOn(session.user.shopId, page);
  // `uuidParam`, like `deleteBoatAction` two hundred lines down: a malformed id
  // reaches `eq(divePackages.id, $1)` against a uuid column, Postgres raises
  // 22P02, and the owner gets an unhandled 500 where a refusal belongs
  // (`security-reviewer`, issue #706).
  const packageId = uuidParam(readForm(packageIdForm, formData).packageId);
  if (!packageId) {
    redirect(noticeUrl(section, "package-invalid"));
  }
  // Deliberately the same notice whether or not a row matched: a cross-tenant
  // id must not be distinguishable from a real one.
  await deleteDivePackage(await getDb(), session.user.shopId, packageId);
  revalidateAndRedirect(page, noticeUrl(section, "package-deleted"));
}
