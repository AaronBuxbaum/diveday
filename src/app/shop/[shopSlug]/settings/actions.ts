"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonManagePaymentSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import {
  getShopById,
  setShopAddress,
  setShopContact,
  setShopCurrency,
  setShopDepthUnit,
  setShopDockCallMinutes,
  setShopPackingList,
  setShopRentalItems,
  setShopRentalPricing,
  setShopReviewUrl,
  setShopTemperatureUnit,
  setShopTimezone,
} from "@/db/shops";
import {
  disconnectShopStripeAccount,
  getShopStripeAccount,
  refreshShopStripeAccountStatus,
} from "@/db/stripe-accounts";
import { isValidTimeZone } from "@/lib/format";
import { isShopCurrency, majorToMinor, maxPriceMajor, toShopCurrency } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { connectProviderFromEnvironment } from "@/lib/payments/connect";
import {
  RENTABLE_ITEMS,
  type RentalPricing,
  SHOP_CATALOG_ITEMS,
  shopOffersNitrox,
  toRentableKinds,
} from "@/lib/rentals";
import { requireStaffSession } from "@/lib/session";

/* -------------------------------------------------------------------------- *
 * Shop settings mutations
 *
 * Every form on `./SettingsPage.tsx` posts to one of these. They share a shape:
 * re-derive the session server-side, validate the submission, refuse by
 * redirecting back to the settings page with `?notice=<code>&saved=<section>`
 * so the page can render the refusal *inside* the section that produced it, and
 * on success revalidate and redirect the same way with a success code.
 *
 * The notice codes are matched by `noticeMessages()` in `SettingsPage.tsx` and
 * the section ids by its `SECTION_IDS` — a new action here needs a row in both.
 * -------------------------------------------------------------------------- */

/**
 * Payment settings (Stripe Connect and the rental catalog/prices) are
 * owner/manager work (H-14, ADR 20260724-role-authorization), re-checked
 * against live roles. Returns the settings redirect target when the actor
 * lacks the gate, or null when they may proceed. The other sections here
 * (contact, packing, dock call) are ordinary shop settings any staff can edit.
 */
async function paymentSettingsBlock(session: {
  user: { shopId: string; personId: string; shopSlug: string };
}): Promise<string | null> {
  const allowed = await canPersonManagePaymentSettings(
    await getDb(),
    session.user.shopId,
    session.user.personId,
  );
  return allowed ? null : `/shop/${session.user.shopSlug}/settings?notice=not_authorized`;
}

const contactSchema = z.object({
  // Empty clears the field; anything else must be a real address, because this
  // one is printed on a public page for divers to write to.
  contactEmail: z.union([z.literal(""), z.email().max(200)]),
  contactPhone: z.string().trim().max(40),
});

const addressSchema = z.object({
  // Every field is optional and clears independently on empty — a shop can
  // publish just a country, or walk the whole address back to nothing.
  addressStreet: z.string().trim().max(200),
  addressLocality: z.string().trim().max(120),
  addressRegion: z.string().trim().max(120),
  addressPostalCode: z.string().trim().max(20),
  addressCountry: z.string().trim().max(2),
});

const reviewUrlSchema = z.object({
  // Empty clears it — the recap flow simply skips the review ask when unset,
  // rather than guessing a platform. z.url() alone accepts any scheme
  // (data:, mailto:, ftp:, even plain http:); this renders directly as a
  // public `target="_blank"` link on the recap page, so only https is safe.
  reviewUrl: z.union([
    z.literal(""),
    z
      .url()
      .max(500)
      .refine((value) => value.startsWith("https://"), {
        error: "Review link must start with https://",
      }),
  ]),
});

export async function savePackingAction(formData: FormData) {
  const session = await requireStaffSession();
  const packingList = String(formData.get("packingList") ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  if (
    packingList.length < 1 ||
    packingList.length > 12 ||
    packingList.some((item) => item.length > 100)
  ) {
    redirect(`/shop/${session.user.shopSlug}/settings?notice=packing_invalid&saved=packing`);
  }
  await setShopPackingList(await getDb(), session.user.shopId, packingList);
  revalidateAndRedirect(
    `/shop/${session.user.shopSlug}/settings`,
    `/shop/${session.user.shopSlug}/settings?notice=packing_saved&saved=packing`,
  );
}

/**
 * Whether this shop reads depths in metres or feet. Display and entry only —
 * every stored depth stays metres, so switching back and forth is lossless and
 * no site's recorded depth moves.
 */
export async function saveDepthUnitAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = `/shop/${session.user.shopSlug}/settings`;
  const parsed = z.enum(["meters", "feet"]).safeParse(formData.get("depthUnit"));
  if (!parsed.success) redirect(`${settings}?notice=depth_unit_invalid&saved=depthUnit`);
  await setShopDepthUnit(await getDb(), session.user.shopId, parsed.data);
  revalidateAndRedirect(settings, `${settings}?notice=depth_unit_saved&saved=depthUnit`);
}

/**
 * Whether this shop reads water temperature in Celsius or Fahrenheit. Its own
 * setting rather than a reading of the depth unit above (a shop can dive in
 * feet and talk about the water in Celsius), and lossless on the same terms —
 * `trips.water_temperature_c` stays Celsius, so switching back and forth moves
 * no recorded reading.
 */
export async function saveTemperatureUnitAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = `/shop/${session.user.shopSlug}/settings`;
  const parsed = z.enum(["celsius", "fahrenheit"]).safeParse(formData.get("temperatureUnit"));
  if (!parsed.success)
    redirect(`${settings}?notice=temperature_unit_invalid&saved=temperatureUnit`);
  await setShopTemperatureUnit(await getDb(), session.user.shopId, parsed.data);
  revalidateAndRedirect(
    settings,
    `${settings}?notice=temperature_unit_saved&saved=temperatureUnit`,
  );
}

/**
 * The currency this shop displays and charges in.
 *
 * Unlike the depth unit above, this one is not lossless and the form says so:
 * stored amounts are integer minor units of whatever currency was set when
 * they were typed, and nothing is converted here. Already-settled rows keep
 * their own currency, so this only ever changes what a *future* charge and the
 * shop's own price list mean.
 *
 * Owner/manager only, re-checked here against live roles rather than trusted
 * from the section merely having rendered — this decides what a diver's card
 * is charged in.
 */
export async function saveCurrencyAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = `/shop/${session.user.shopSlug}/settings`;
  const blocked = await paymentSettingsBlock(session);
  if (blocked) {
    revalidateAndRedirect(settings, blocked);
    return;
  }
  const submitted = formData.get("currency");
  // Not `toShopCurrency`: that coerces anything unknown to usd, which would
  // silently save dollars for a shop that submitted a typo. An unrecognized
  // value is a refusal.
  if (!isShopCurrency(submitted)) {
    redirect(`${settings}?notice=currency_invalid&saved=currency`);
  }
  await setShopCurrency(await getDb(), session.user.shopId, submitted);
  revalidateAndRedirect(settings, `${settings}?notice=currency_saved&saved=currency`);
}

/** How many minutes before departure divers are asked to be at the dock. */
export async function saveDockCallAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = `/shop/${session.user.shopSlug}/settings`;
  const minutes = Number(formData.get("dockCallMinutes"));
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 180) {
    redirect(`${settings}?notice=dock_invalid&saved=dockCall`);
  }
  await setShopDockCallMinutes(await getDb(), session.user.shopId, minutes);
  revalidateAndRedirect(settings, `${settings}?notice=dock_saved&saved=dockCall`);
}

/** Which gear the shop rents. Unchecked kinds simply drop out of the catalog. */
export async function saveRentalItemsAction(formData: FormData) {
  const session = await requireStaffSession();
  const blocked = await paymentSettingsBlock(session);
  if (blocked) {
    revalidateAndRedirect(`/shop/${session.user.shopSlug}/settings`, blocked);
    return;
  }
  const selected = SHOP_CATALOG_ITEMS.filter((item) => formData.get(item.name) === "on").map(
    (item) => item.kind,
  );
  await setShopRentalItems(await getDb(), session.user.shopId, toRentableKinds(selected));
  revalidateAndRedirect(
    `/shop/${session.user.shopSlug}/settings`,
    `/shop/${session.user.shopSlug}/settings?notice=rentals_saved&saved=rentals`,
  );
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
  const settings = `/shop/${session.user.shopSlug}/settings`;
  const blocked = await paymentSettingsBlock(session);
  if (blocked) {
    revalidateAndRedirect(settings, blocked);
    return;
  }
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect(`${settings}?notice=rental_prices_invalid&saved=rentalPricing`);
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
  if (invalid || !set.ok) redirect(`${settings}?notice=rental_prices_invalid&saved=rentalPricing`);
  await setShopRentalPricing(db, session.user.shopId, {
    setCents: set.cents,
    perItemCents,
    nitroxCents,
  });
  revalidateAndRedirect(settings, `${settings}?notice=rental_prices_saved&saved=rentalPricing`);
}

/**
 * The address a diver who is not booking yet writes to. Published, so an empty
 * box is a real answer — it takes the "Get in touch" composer off the shop's
 * course pages rather than publishing a blank contact.
 */
export async function saveContactAction(formData: FormData) {
  const session = await requireStaffSession();
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  const settings = `/shop/${session.user.shopSlug}/settings`;
  if (!parsed.success) redirect(`${settings}?notice=contact_invalid&saved=contact`);
  await setShopContact(await getDb(), session.user.shopId, parsed.data);
  revalidateAndRedirect(settings, `${settings}?notice=contact_saved&saved=contact`);
}

/**
 * The shop's physical business address — where a diver actually meets the
 * boat or walks into the storefront. Published in structured data so search
 * engines can place the shop as a real venue; every field clears
 * independently on an empty box.
 */
export async function saveAddressAction(formData: FormData) {
  const session = await requireStaffSession();
  const parsed = addressSchema.safeParse(Object.fromEntries(formData));
  const settings = `/shop/${session.user.shopSlug}/settings`;
  if (!parsed.success) redirect(`${settings}?notice=address_invalid&saved=address`);
  await setShopAddress(await getDb(), session.user.shopId, parsed.data);
  revalidateAndRedirect(settings, `${settings}?notice=address_saved&saved=address`);
}

/** Where the post-trip recap's "leave us a review" link sends a diver. */
export async function saveReviewUrlAction(formData: FormData) {
  const session = await requireStaffSession();
  const parsed = reviewUrlSchema.safeParse(Object.fromEntries(formData));
  const settings = `/shop/${session.user.shopSlug}/settings`;
  if (!parsed.success) redirect(`${settings}?notice=review_url_invalid&saved=reviewLink`);
  await setShopReviewUrl(await getDb(), session.user.shopId, parsed.data.reviewUrl);
  revalidateAndRedirect(settings, `${settings}?notice=review_url_saved&saved=reviewLink`);
}

export async function disconnectAction() {
  const session = await requireStaffSession();
  const blocked = await paymentSettingsBlock(session);
  if (blocked) {
    revalidateAndRedirect(`/shop/${session.user.shopSlug}/settings`, blocked);
    return;
  }
  const db = await getDb();
  const account = await getShopStripeAccount(db, session.user.shopId);
  if (account && !account.disconnectedAt) {
    const provider = connectProviderFromEnvironment();
    await provider.deauthorize(account.stripeAccountId);
    await disconnectShopStripeAccount(db, account.stripeAccountId);
  }
  revalidateAndRedirect(
    `/shop/${session.user.shopSlug}/settings`,
    `/shop/${session.user.shopSlug}/settings?notice=disconnected&saved=stripe`,
  );
}

export async function refreshAction() {
  const session = await requireStaffSession();
  const blocked = await paymentSettingsBlock(session);
  if (blocked) {
    revalidateAndRedirect(`/shop/${session.user.shopSlug}/settings`, blocked);
    return;
  }
  const db = await getDb();
  const account = await getShopStripeAccount(db, session.user.shopId);
  if (account) {
    const provider = connectProviderFromEnvironment();
    const status = await provider.retrieveAccountStatus(account.stripeAccountId);
    await refreshShopStripeAccountStatus(db, account.stripeAccountId, status);
  }
  revalidateAndRedirect(
    `/shop/${session.user.shopSlug}/settings`,
    `/shop/${session.user.shopSlug}/settings?notice=refreshed&saved=stripe`,
  );
}

/**
 * The zone this shop's whole schedule is read and written in.
 *
 * Sign-up asks for it once and nothing could change it afterwards, so a shop
 * that clicked past the picker — or moved — was stuck reading its own
 * departures in US Eastern with no way out but a support request. Not a
 * display preference like the two below: every wall-clock time a staff member
 * types is interpreted through this, so changing it re-reads existing
 * departures at their new local times rather than moving them. That is the
 * right answer for the case this exists for, and the description on the card
 * says so before anyone touches it.
 */
export async function saveTimezoneAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = `/shop/${session.user.shopSlug}/settings`;
  const submitted = formData.get("timezone");
  // An id this runtime can't resolve would make every date formatter on every
  // surface throw, so an unrecognized value is a refusal, never a fallback.
  if (typeof submitted !== "string" || !isValidTimeZone(submitted)) {
    redirect(`${settings}?notice=timezone_invalid&saved=timezone`);
  }
  await setShopTimezone(await getDb(), session.user.shopId, submitted);
  revalidateAndRedirect(settings, `${settings}?notice=timezone_saved&saved=timezone`);
}
