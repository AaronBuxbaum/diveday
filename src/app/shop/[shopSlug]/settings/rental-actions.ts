"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import {
  getShopById,
  setShopRentalItems,
  setShopRentalPricing,
  setShopRentalTerms,
} from "@/db/shops";
import { majorToMinor, maxPriceMajor, toShopCurrency } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { parseRentalTerms } from "@/lib/rental-terms";
import {
  RENTABLE_ITEMS,
  type RentalPricing,
  SHOP_CATALOG_ITEMS,
  shopOffersNitrox,
  toRentableKinds,
} from "@/lib/rentals";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { paymentSettingsBlock, settingsBlock } from "./action-helpers";

/** Which gear the shop rents. Unchecked kinds simply drop out of the catalog. */
export async function saveRentalItemsAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "rentals");
  await settingsBlock(session);
  await paymentSettingsBlock(session);
  const selected = SHOP_CATALOG_ITEMS.filter((item) => formData.get(item.name) === "on").map(
    (item) => item.kind,
  );
  await setShopRentalItems(await getDb(), session.user.shopId, toRentableKinds(selected));
  revalidateAndRedirect(page, noticeUrl(page, "rentals-saved"));
}

/**
 * A major-unit amount from a price box → stored minor units, or null for an
 * empty box (not priced online). Anything else — a negative, a non-number, an
 * absurd amount — is invalid so the whole save is rejected rather than
 * silently zeroed.
 *
 * The currency decides the multiplier: typing 5000 into a JPY shop's box means
 * ¥5,000 and stores 5000, not 500000 (`majorToMinor`).
 */
function parsePriceAmount(
  raw: FormDataEntryValue | null,
  currency: string,
): { ok: true; cents: number | null } | { ok: false } {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, cents: null };
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0 || amount > maxPriceMajor(currency)) {
    return { ok: false };
  }
  return { ok: true, cents: majorToMinor(amount, currency) };
}

/** What the shop charges for rental gear: a set price, per-piece prices, and per-dive nitrox. */
export async function saveRentalPricingAction(formData: FormData) {
  const session = await requireStaffSession();
  const page = shopPath(session.user.shopSlug, "settings", "rental-prices");
  await settingsBlock(session);
  await paymentSettingsBlock(session);
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect(noticeUrl(page, "rental-prices-invalid"));
  const currency = toShopCurrency(shop.currency);
  const set = parsePriceAmount(formData.get("setPrice"), currency);
  let invalid = !set.ok;
  const perItemCents: RentalPricing["perItemCents"] = {};
  for (const item of RENTABLE_ITEMS) {
    const parsed = parsePriceAmount(formData.get(`price_${item.name}`), currency);
    if (!parsed.ok) {
      invalid = true;
      continue;
    }
    if (parsed.cents !== null) perItemCents[item.kind] = parsed.cents;
  }
  // The nitrox price field only renders when the catalog currently offers
  // nitrox; when it doesn't, the field is absent from every submission, so
  // reading it as "clear the price" would erase a price set while nitrox was
  // still offered. Only interpret it when it could have been on the page.
  let nitroxCents = shop.rentalPricing.nitroxCents;
  if (shopOffersNitrox(shop.rentalItems)) {
    const nitrox = parsePriceAmount(formData.get("nitroxPrice"), currency);
    if (!nitrox.ok) invalid = true;
    else nitroxCents = nitrox.cents;
  }
  if (invalid || !set.ok) {
    redirect(noticeUrl(page, "rental-prices-invalid"));
  }
  await setShopRentalPricing(db, session.user.shopId, {
    setCents: set.cents,
    perItemCents,
    nitroxCents,
  });
  revalidateAndRedirect(page, noticeUrl(page, "rental-prices-saved"));
}

/**
 * The shop's own rental terms, printed on every rental ticket above the
 * "Received by" line (ADR 20260815-minimal-gear-register, amended 2026-10-08).
 * It sits in the Rental gear group, which only a payments-settings reader
 * sees, so it asks the same two gates the rental prices do. An empty box
 * prints none.
 */
export async function saveRentalTermsAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);
  await paymentSettingsBlock(session);
  const parsed = parseRentalTerms(formData.get("rentalTerms"));
  if (!parsed.ok) {
    redirect(noticeUrl(settings, "rental-terms-invalid", { saved: "rentalTerms" }));
  }
  const db = await getDb();
  await setShopRentalTerms(db, session.user.shopId, parsed.terms);
  revalidateAndRedirect(
    settings,
    noticeUrl(settings, "rental-terms-saved", { saved: "rentalTerms" }),
  );
}
