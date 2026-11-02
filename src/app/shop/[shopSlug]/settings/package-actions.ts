"use server";

import { z } from "zod";
import type { AppDb } from "@/db/client";
import { createDivePackage, deleteDivePackage } from "@/db/dive-packages";
import { maxLineItemUnitAmountCents } from "@/db/orders";
import { shopHasFeatureOn } from "@/db/shops";
import { getShopCurrency } from "@/db/stripe-accounts";
import { defineAction, land, type NoticeOf } from "@/features/server-action";
import { validateDivePackage } from "@/lib/dive-packages";
import { formValue, text, trimmedText } from "@/lib/form-parse";
import { majorToMinor, toShopCurrency } from "@/lib/money";
import { uuidParam } from "@/lib/uuid";
import { SETTINGS_AND_PAYMENT_GATES } from "./action-gates";

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
async function packagesOff(db: AppDb, shopId: string): Promise<boolean> {
  return !(await shopHasFeatureOn(db, shopId, "divePackages"));
}

/**
 * Add a prepaid dive package to the shop's price list
 * (ADR 20260822-a-package-is-entitlements-not-money).
 *
 * Behind the payment-settings gate like every other price on this page: a
 * package is what the shop charges, and `canManagePaymentSettings`'s own
 * docstring names pricing as what it gates.
 *
 * Packages are a section of Promos (visual review 2026-10-24, A26): every
 * answer lands on that section.
 */
export const createDivePackageAction = defineAction({
  gate: SETTINGS_AND_PAYMENT_GATES,
  input: packageForm,
  async run({ db, shopId, personId, path }, form) {
    const section = `${path("promos")}#dive-packages`;
    if (await packagesOff(db, shopId)) return land(path("promos"));
    // The shop's own currency decides the multiplier, the same way every other
    // price box on this page is read — 5000 in a JPY shop is ¥5,000.
    const currency = toShopCurrency(await getShopCurrency(db, shopId));
    const validated = validateDivePackage({
      name: form.name,
      diveCount: Number(form.diveCount),
      priceCents: majorToMinor(Number(form.priceDollars), currency),
      scope: form.scope === "fun_dives" ? "fun_dives" : "all",
      maxPriceCents: maxLineItemUnitAmountCents(currency),
      // Blank means "never lapses"; otherwise the shop chooses an inclusive
      // calendar date rather than a purchase-time duration.
      validUntil: form.validUntil === "" ? null : form.validUntil,
    });
    if (!validated.ok) return land(section, "package-invalid");
    await createDivePackage(db, { shopId, createdByPersonId: personId, ...validated.value });
    return land(section, "package-saved");
  },
});

/**
 * Stop selling one. Soft, and here that is load-bearing rather than
 * conventional: the dives somebody already bought reference this row and must
 * outlive it.
 */
export const deleteDivePackageAction = defineAction({
  gate: SETTINGS_AND_PAYMENT_GATES,
  input: packageIdForm,
  async run({ db, shopId, path }, form) {
    const section = `${path("promos")}#dive-packages`;
    if (await packagesOff(db, shopId)) return land(path("promos"));
    // `uuidParam`, like `deleteBoatAction`: a malformed id reaches
    // `eq(divePackages.id, $1)` against a uuid column, Postgres raises 22P02,
    // and the owner gets an unhandled 500 where a refusal belongs
    // (`security-reviewer`, issue #706).
    const packageId = uuidParam(form.packageId);
    if (!packageId) return land(section, "package-invalid");
    // Deliberately the same notice whether or not a row matched: a cross-tenant
    // id must not be distinguishable from a real one.
    await deleteDivePackage(db, shopId, packageId);
    return land(section, "package-deleted");
  },
});

/** What the Promos packages section can be told (`divePackageNoticeMessages`). */
export type DivePackageNotice = NoticeOf<
  typeof createDivePackageAction | typeof deleteDivePackageAction
>;
