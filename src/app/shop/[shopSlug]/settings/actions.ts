"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  canPersonErasePersonalData,
  canPersonManagePaymentSettings,
  canPersonManageShopSettings,
} from "@/db/authz";
import { getDb } from "@/db/client";
import { retryMediaDeletion } from "@/db/media-deletions";
import { dischargeProcessorErasure, retryProcessorErasure } from "@/db/processor-erasure";
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
import {
  type AddressLookupResult,
  addressLookupConfigFromEnvironment,
  isLookupWorthy,
} from "@/lib/address-lookup";
import { isValidTimeZone } from "@/lib/format";
import {
  isShopCurrency,
  majorToMinor,
  maxPriceMajor,
  type ShopCurrency,
  toShopCurrency,
} from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { connectProviderFromEnvironment } from "@/lib/payments/connect";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
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
 * **Every** mutation on this page is owner/manager work now, re-checked here
 * against live roles rather than the roles baked into the JWT at sign-in.
 *
 * Hiding the page is a courtesy, never the gate: a server action is a POST
 * endpoint whose id ships to any browser that has ever rendered the form, so
 * without this a demoted staffer — or anyone who kept an old page open — could
 * still rewrite the shop's timezone, address, or packing list. Returns the
 * settings redirect target when the actor lacks the gate, or null when they
 * may proceed.
 */
async function settingsBlock(session: {
  user: { shopId: string; personId: string; shopSlug: string };
}): Promise<string | null> {
  const allowed = await canPersonManageShopSettings(
    await getDb(),
    session.user.shopId,
    session.user.personId,
  );
  return allowed ? null : `/shop/${session.user.shopSlug}/settings?notice=not_authorized`;
}

/**
 * Payment settings (Stripe Connect and the rental catalog/prices) are
 * owner/manager work (H-14, ADR 20260724-role-authorization), re-checked
 * against live roles. Returns the settings redirect target when the actor
 * lacks the gate, or null when they may proceed. Narrower than
 * {@link settingsBlock} by intent rather than by effect — the two resolve to
 * the same roles today, and each states its own reason so one can move without
 * silently dragging the other.
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
  const notAllowed = await settingsBlock(session);
  if (notAllowed) {
    revalidateAndRedirect(`/shop/${session.user.shopSlug}/settings`, notAllowed);
    return;
  }
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
 * The three units a shop reads its own numbers in — depth, water temperature,
 * and money — saved together from one card.
 *
 * The first two are display and entry only: every stored depth stays metres and
 * every stored reading stays Celsius (`trips.water_temperature_c`), so
 * switching back and forth is lossless and no recorded site depth moves. They
 * are also independent of each other, which is why the shop picks both — a
 * Caribbean operator serving American divers publishes feet and Celsius.
 *
 * Currency is the odd one out on both counts, and the card's own copy says so.
 * It is not lossless: stored amounts are integer minor units of whatever
 * currency was set when they were typed, nothing is converted here, and
 * already-settled rows keep their own currency, so this only changes what a
 * *future* charge and the shop's price list mean. And it is owner/manager work
 * (H-14) rather than anything a divemaster may do, because it decides what a
 * diver's card is charged in.
 *
 * That gate is enforced twice. The page renders the currency `<select>` only
 * for an actor who passes it, and a submission that carries a `currency` field
 * anyway is re-checked here against live roles. A refusal drops the *whole*
 * submission rather than quietly saving the depth and temperature halves: a
 * staffer who posted three values and got back "not authorized" should not have
 * to guess which two landed.
 */
export async function saveUnitsAction(formData: FormData) {
  const session = await requireStaffSession();
  const notAllowed = await settingsBlock(session);
  if (notAllowed) {
    revalidateAndRedirect(`/shop/${session.user.shopSlug}/settings`, notAllowed);
    return;
  }
  const settings = `/shop/${session.user.shopSlug}/settings`;
  const depthUnit = z.enum(["meters", "feet"]).safeParse(formData.get("depthUnit"));
  const temperatureUnit = z
    .enum(["celsius", "fahrenheit"])
    .safeParse(formData.get("temperatureUnit"));
  if (!depthUnit.success || !temperatureUnit.success) {
    redirect(`${settings}?notice=units_invalid&saved=units`);
  }

  // `null` means the field was never rendered (the actor cannot manage payment
  // settings), which is the ordinary case for most staff — not a refusal.
  const submittedCurrency = formData.get("currency");
  let currency: ShopCurrency | null = null;
  if (submittedCurrency !== null) {
    const blocked = await paymentSettingsBlock(session);
    if (blocked) {
      revalidateAndRedirect(settings, blocked);
      return;
    }
    // Not `toShopCurrency`: that coerces anything unknown to usd, which would
    // silently save dollars for a shop that submitted a typo. An unrecognized
    // value is a refusal.
    if (!isShopCurrency(submittedCurrency)) {
      redirect(`${settings}?notice=units_invalid&saved=units`);
    }
    currency = submittedCurrency;
  }

  const db = await getDb();
  await setShopDepthUnit(db, session.user.shopId, depthUnit.data);
  await setShopTemperatureUnit(db, session.user.shopId, temperatureUnit.data);
  if (currency !== null) {
    await setShopCurrency(db, session.user.shopId, currency);
  }
  revalidateAndRedirect(settings, `${settings}?notice=units_saved&saved=units`);
}

/** How many minutes before departure divers are asked to be at the dock. */
export async function saveDockCallAction(formData: FormData) {
  const session = await requireStaffSession();
  const notAllowed = await settingsBlock(session);
  if (notAllowed) {
    revalidateAndRedirect(`/shop/${session.user.shopSlug}/settings`, notAllowed);
    return;
  }
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
  const notAllowed = await settingsBlock(session);
  if (notAllowed) {
    revalidateAndRedirect(`/shop/${session.user.shopSlug}/settings`, notAllowed);
    return;
  }
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
  const notAllowed = await settingsBlock(session);
  if (notAllowed) {
    revalidateAndRedirect(`/shop/${session.user.shopSlug}/settings`, notAllowed);
    return;
  }
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
  const notAllowed = await settingsBlock(session);
  if (notAllowed) {
    revalidateAndRedirect(`/shop/${session.user.shopSlug}/settings`, notAllowed);
    return;
  }
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
  const notAllowed = await settingsBlock(session);
  if (notAllowed) {
    revalidateAndRedirect(`/shop/${session.user.shopSlug}/settings`, notAllowed);
    return;
  }
  const parsed = addressSchema.safeParse(Object.fromEntries(formData));
  const settings = `/shop/${session.user.shopSlug}/settings`;
  if (!parsed.success) redirect(`${settings}?notice=address_invalid&saved=address`);
  await setShopAddress(await getDb(), session.user.shopId, parsed.data);
  revalidateAndRedirect(settings, `${settings}?notice=address_saved&saved=address`);
}

/** Where the post-trip recap's "leave us a review" link sends a diver. */
export async function saveReviewUrlAction(formData: FormData) {
  const session = await requireStaffSession();
  const notAllowed = await settingsBlock(session);
  if (notAllowed) {
    revalidateAndRedirect(`/shop/${session.user.shopSlug}/settings`, notAllowed);
    return;
  }
  const parsed = reviewUrlSchema.safeParse(Object.fromEntries(formData));
  const settings = `/shop/${session.user.shopSlug}/settings`;
  if (!parsed.success) redirect(`${settings}?notice=review_url_invalid&saved=reviewLink`);
  await setShopReviewUrl(await getDb(), session.user.shopId, parsed.data.reviewUrl);
  revalidateAndRedirect(settings, `${settings}?notice=review_url_saved&saved=reviewLink`);
}

export async function disconnectAction() {
  const session = await requireStaffSession();
  const notAllowed = await settingsBlock(session);
  if (notAllowed) {
    revalidateAndRedirect(`/shop/${session.user.shopSlug}/settings`, notAllowed);
    return;
  }
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
  const notAllowed = await settingsBlock(session);
  if (notAllowed) {
    revalidateAndRedirect(`/shop/${session.user.shopSlug}/settings`, notAllowed);
    return;
  }
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
  const notAllowed = await settingsBlock(session);
  if (notAllowed) {
    revalidateAndRedirect(`/shop/${session.user.shopSlug}/settings`, notAllowed);
    return;
  }
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

/**
 * Address suggestions for the address card's type-ahead.
 *
 * The one action on this page that returns a value instead of redirecting: the
 * card is a combobox, and the caller renders the rows.
 *
 * Four things guard it, in order, and each is doing separate work:
 *
 *  1. **The session.** `requireStaffSession` — never an open endpoint.
 *  2. **The settings gate**, live-checked, the same one every mutation above
 *     takes. Reading a geocoder is not a mutation, but it spends the shop's
 *     money per request and it is reached only from a page a captain cannot
 *     open; leaving the action ungated would make it the way around that.
 *  3. **A rate limit**, keyed on the staff member. The billing risk here is not
 *     an attacker so much as a type-ahead firing per keystroke, and the cap
 *     bounds both.
 *  4. **A length bound**, so the box can never push a large body at a metered
 *     third-party API.
 *
 * Everything it returns is provider text that ends up in React children and
 * `value` attributes — escaped by default, and never `dangerouslySetInnerHTML`.
 * The query itself is a partial business address and is never logged.
 */
export async function suggestAddressAction(query: string): Promise<AddressLookupResult> {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonManageShopSettings(db, session.user.shopId, session.user.personId))) {
    return { status: "failed" };
  }
  if (typeof query !== "string" || !isLookupWorthy(query)) return { status: "too_short" };

  const allowed = await checkRateLimit(
    rateLimitKey("address-lookup", session.user.personId),
    RATE_LIMITS.addressLookup,
  );
  // Its own answer, not `failed`: the hour's billed-request budget being spent
  // is a temporary, self-healing state, and reporting it as the same dead-end
  // sentence a broken geocoder shows is what made a resting lookup read as one
  // that simply does not work (2026-08-06 review).
  if (!allowed.allowed) return { status: "rate_limited" };

  const config = addressLookupConfigFromEnvironment();
  // The ordinary local and self-hosted case, not an error: the card falls back
  // to the plain boxes it has always been.
  if (!config) return { status: "not_configured" };

  // Imported here rather than at module scope so a deployment with no
  // credentials never loads the AWS SDK at all.
  const { awsAddressLookupProvider } = await import("@/lib/address-lookup-aws");
  return awsAddressLookupProvider(config).suggest(query);
}

/* -------------------------------------------------------------------------- *
 * Data-compliance queues (the "Data & integrations" group)
 *
 * Two jobs the shop still owes on data it promised to remove: a stored file a
 * provider delete never got rid of (CR-012) and an erasure that didn't land at
 * Stripe (ADR 20260803-processor-erasure-obligations). They lived at the bottom
 * of the monthly report until the report became only a report; "what happened
 * to data we said we'd delete?" is the Data group's question, and this page is
 * where it is now asked.
 *
 * The gates are unchanged in substance. The media retry moved from the reports
 * gate to the settings gate — the same `isOwnerOrManager` role set, so nobody
 * gained or lost the button — and both processor-erasure actions keep the
 * owner-only `canPersonErasePersonalData` they always had. Each re-checks
 * server-side and returns silently on refusal rather than trusting the page
 * that rendered the form.
 *
 * They call the predicates directly rather than through `settingsBlock` above:
 * that helper hands back a `?notice=not_authorized` redirect target, which is
 * the right answer for a card the page renders for everyone and wrong for a
 * panel it renders for nobody who would be refused. A hand-made post here gets
 * silence, not an explanation of a control that was never on screen.
 *
 * The path they revalidate comes from `session.user.shopSlug`, never from a
 * bound argument. A server action's arguments are attacker-controlled — the
 * action id ships to the browser and a hand-crafted POST supplies whatever it
 * likes — so a bound slug would let a signed-in staffer of shop A invalidate
 * shop B's cached settings page. The writes above were never at risk (every
 * one is scoped by `session.user.shopId`); this closes the cache-invalidation
 * half, and matches how `settingsBlock` and the rest of this file already
 * derive the slug.
 * -------------------------------------------------------------------------- */

/**
 * The "Retry" for a stuck provider delete (CR-012) — same owner/manager weight
 * as every other control on this page, so a crew member can't reach it by
 * posting directly to the action.
 */
export async function retryMediaDeletionAction(formData: FormData) {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonManageShopSettings(db, session.user.shopId, session.user.personId))) return;
  const attemptId = String(formData.get("attemptId") ?? "");
  if (!attemptId) return;
  await retryMediaDeletion(db, session.user.shopId, attemptId);
  revalidatePath(`/shop/${session.user.shopSlug}/settings`);
}

/**
 * Re-attempt a Stripe customer delete erasure could not land
 * (ADR 20260803-processor-erasure-obligations) — the manual companion to the
 * nightly retry, for an owner who has just fixed whatever was broken (a
 * reconnected Stripe account, an outage that has passed) and does not want to
 * wait for the next tick.
 *
 * Same erasure gate as the attestation below: this makes a destructive call
 * against the shop's Stripe account, so it is not a settings-reader's button.
 */
export async function retryProcessorErasureAction(formData: FormData) {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonErasePersonalData(db, session.user.shopId, session.user.personId))) return;
  const obligationId = String(formData.get("obligationId") ?? "");
  if (!obligationId) return;
  await retryProcessorErasure(db, session.user.shopId, obligationId);
  revalidatePath(`/shop/${session.user.shopSlug}/settings`);
}

/**
 * Mark a processor-side erasure done (ADR 20260803-processor-erasure-obligations).
 *
 * This is the *only* way an invoice-snapshot obligation ever closes: no API
 * reaches the name and email Stripe copied onto a finalized invoice, so an
 * owner attests they filed Stripe's data-deletion request.
 *
 * Gated on `canPersonErasePersonalData`, not on the settings gate the panel is
 * *read* behind: this is an attestation that a diver's data is gone from
 * Stripe, and only the role that could order the erasure may declare it
 * finished. A manager who can read the panel sees the outstanding work and
 * cannot sign it off.
 */
export async function dischargeProcessorErasureAction(formData: FormData) {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonErasePersonalData(db, session.user.shopId, session.user.personId))) return;
  const obligationId = String(formData.get("obligationId") ?? "");
  if (!obligationId) return;
  await dischargeProcessorErasure(db, {
    shopId: session.user.shopId,
    obligationId,
    actorPersonId: session.user.personId,
  });
  revalidatePath(`/shop/${session.user.shopSlug}/settings`);
}
