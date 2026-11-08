"use server";

import { z } from "zod";
import { getShopById, recordShopRentals } from "@/db/shops";
import { formValue } from "@/features/form-parse";
import { parseRentalTerms } from "@/features/rental-terms";
import { defineAction, land, type NoticeOf } from "@/features/server-action";
import { majorToMinor, maxPriceMajor, toShopCurrency } from "@/lib/money";
import { parseNitroxFillMethod } from "@/lib/nitrox-fill";
import {
  RENTABLE_ITEMS,
  type RentalPricing,
  SHOP_CATALOG_ITEMS,
  shopOffersNitrox,
  toRentableKinds,
} from "@/lib/rentals";
import { isCustomerRegulatorServiceMonths } from "@/lib/work-orders";
import { SETTINGS_AND_PAYMENT_GATES } from "./action-gates";

/**
 * The rental forms name a field per catalog item (`mask`, `price_mask`), so
 * every field rides the catch-all, each read as `FormData.get` read it; the
 * actions below narrow each one themselves.
 */
const rentalFields = z.object({}).catchall(formValue());

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

/**
 * **The Rentals page's one save** (#2815): what the shop rents, what each piece
 * costs, the terms every rental ticket prints (ADR 20260815-minimal-gear-register,
 * amended 2026-10-08), how often a customer's regulator is serviced (#2272)
 * and how the shop fills nitrox (issue 3004).
 * Two settings pages and four rail rows were one job; this is its one action.
 *
 * It asks both gates the rental catalog always asked, then validates the whole
 * submission before it writes anything, so a bad price never leaves the terms
 * half-saved. A price box belongs to a ticked piece: an unticked piece (and
 * nitrox, unticked) keeps the price it had, so unticking and ticking again
 * never loses it, and a hand-made post cannot rewrite the price of a piece the
 * shop does not rent.
 */
export const saveRentalsAction = defineAction({
  gate: SETTINGS_AND_PAYMENT_GATES,
  input: rentalFields,
  async run({ db, shopId, path }, fields) {
    const page = path("settings", "rentals");
    const shop = await getShopById(db, shopId);
    if (!shop) return land(page, "rental-prices-invalid");
    const currency = toShopCurrency(shop.currency);

    const selected = SHOP_CATALOG_ITEMS.filter((item) => fields[item.name] === "on").map(
      (item) => item.kind,
    );
    const rentalItems = toRentableKinds(selected);
    const offered = new Set(rentalItems);

    const set = parsePriceAmount(fields.setPrice ?? null, currency);
    let pricesInvalid = !set.ok;
    const perItemCents: RentalPricing["perItemCents"] = { ...shop.rentalPricing.perItemCents };
    for (const item of RENTABLE_ITEMS) {
      if (!offered.has(item.kind)) continue;
      const parsed = parsePriceAmount(fields[`price_${item.name}`] ?? null, currency);
      if (!parsed.ok) {
        pricesInvalid = true;
        continue;
      }
      if (parsed.cents === null) delete perItemCents[item.kind];
      else perItemCents[item.kind] = parsed.cents;
    }
    let nitroxCents = shop.rentalPricing.nitroxCents;
    if (shopOffersNitrox(rentalItems)) {
      const nitrox = parsePriceAmount(fields.nitroxPrice ?? null, currency);
      if (!nitrox.ok) pricesInvalid = true;
      else nitroxCents = nitrox.cents;
    }
    if (pricesInvalid || !set.ok) return land(page, "rental-prices-invalid");

    const terms = parseRentalTerms(fields.rentalTerms ?? null);
    if (!terms.ok) return land(page, "rental-terms-invalid");

    // The regulator interval belongs to gear servicing: while that is switched
    // off (the Features page) the field is not on the form and the saved value
    // waits unchanged.
    const months = shop.workOrdersEnabled ? Number(fields.regulatorServiceMonths) : null;
    if (months !== null && !isCustomerRegulatorServiceMonths(months)) {
      return land(page, "regulator-service-invalid");
    }

    // How the shop fills nitrox (issue 3004): the form always posts it; a post
    // without it leaves the stored method, and anything but the two is refused.
    const fillMethod =
      fields.nitroxFillMethod === undefined ? null : parseNitroxFillMethod(fields.nitroxFillMethod);
    if (fields.nitroxFillMethod !== undefined && fillMethod === null) {
      return land(page, "nitrox-fill-invalid");
    }

    await recordShopRentals(db, shopId, {
      rentalItems,
      rentalPricing: { setCents: set.cents, perItemCents, nitroxCents },
      rentalTerms: terms.terms,
      customerRegulatorServiceMonths: months ?? undefined,
      nitroxFillMethod: fillMethod ?? undefined,
    });
    return land(page, "rentals-saved");
  },
});

/** What `/settings/rentals` can be told after a save (`rentalsNoticeMessages`). */
export type RentalsNotice = NoticeOf<typeof saveRentalsAction>;
