"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonManageShopSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { convertImportedSiteProseToUnit, shopSearchAnchor } from "@/db/dive-sites";
import { sendNotification } from "@/db/notifications";
import { issueShopContactEmailConfirmation } from "@/db/shop-contact-email";
import {
  getShopById,
  lockShopDepthUnit,
  markShopUnitsConfirmed,
  setShopAddress,
  setShopContact,
  setShopCurrency,
  setShopDepthUnit,
  setShopJuniorBuddyPolicy,
  setShopReopensOn,
  setShopSeasonStart,
  setShopTemperatureUnit,
  setShopTimezone,
} from "@/db/shops";
import { toDiverLocale } from "@/i18n/settings";
import {
  type AddressLookupResult,
  addressLookupConfigFromEnvironment,
  isLookupWorthy,
} from "@/lib/address-lookup";
import { calendarDateInTimezone, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { confirmContactLinkPath } from "@/lib/contact-email-confirmation";
import { formValue, readForm, trimmedText } from "@/lib/form-parse";
import { isValidTimeZone } from "@/lib/format";
import { isShopCurrency, type ShopCurrency } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { reopensOnTooFar } from "@/lib/off-season";
import { publicSchedulePath } from "@/lib/public-routes";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { parseSeasonStart } from "@/lib/season";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { timeZoneAnchor } from "@/lib/timezones";
import { paymentSettingsBlock, settingsBlock } from "./action-helpers";

const contactSchema = z.object({
  // Empty clears the field; anything else must be a real address, because this
  // one is printed on a public page for divers to write to.
  contactEmail: z.union([z.literal(""), z.email().max(200)]),
  contactPhone: z.string().trim().max(40),
});

const addressSchema = z.object({
  // Every text field is required in the form but may be empty: a geocoded
  // place may carry no postcode, and an all-empty submission is the card's
  // Remove control walking the whole address back to nothing. The write is a
  // whole-address replacement (setShopAddress), so the parsed fields are the
  // complete address.
  addressStreet: z.string().trim().max(200),
  addressLocality: z.string().trim().max(120),
  addressRegion: z.string().trim().max(120),
  addressPostalCode: z.string().trim().max(20),
  addressCountry: z.string().trim().max(2),
  latitude: z
    .union([z.literal(""), z.coerce.number().min(-90).max(90)])
    .optional()
    .nullable(),
  longitude: z
    .union([z.literal(""), z.coerce.number().min(-180).max(180)])
    .optional()
    .nullable(),
});

/** Read raw: each action narrows its own values and refuses with its own notice. */
const unitsForm = z.object({
  depthUnit: formValue(),
  temperatureUnit: formValue(),
  currency: formValue(),
});
const timezoneForm = z.object({ timezone: formValue() });

export async function saveJuniorBuddyPolicyAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);
  const value = z.enum(["required", "optional"]).safeParse(formData.get("juniorBuddy"));
  if (!value.success)
    redirect(noticeUrl(settings, "junior-buddy-invalid", { saved: "juniorBuddy" }));
  await setShopJuniorBuddyPolicy(await getDb(), session.user.shopId, value.data === "required");
  revalidateAndRedirect(
    settings,
    noticeUrl(settings, "junior-buddy-saved", { saved: "juniorBuddy" }),
  );
}
const seasonStartForm = z.object({ seasonStartMonth: formValue(), seasonStartDay: formValue() });
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
 * (H-20260724-staff-role-reach) rather than anything a divemaster may do, because it decides what a
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
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);
  const units = readForm(unitsForm, formData);
  const depthUnit = z.enum(["meters", "feet"]).safeParse(units.depthUnit);
  const temperatureUnit = z.enum(["celsius", "fahrenheit"]).safeParse(units.temperatureUnit);
  if (!depthUnit.success || !temperatureUnit.success) {
    redirect(noticeUrl(settings, "units-invalid", { saved: "units" }));
  }

  // `null` means the field was never rendered (the actor cannot manage payment
  // settings), which is the ordinary case for most staff — not a refusal.
  const submittedCurrency = units.currency;
  let currency: ShopCurrency | null = null;
  if (submittedCurrency !== null) {
    await paymentSettingsBlock(session);
    // Not `toShopCurrency`: that coerces anything unknown to usd, which would
    // silently save dollars for a shop that submitted a typo. An unrecognized
    // value is a refusal.
    if (!isShopCurrency(submittedCurrency)) {
      redirect(noticeUrl(settings, "units-invalid", { saved: "units" }));
    }
    currency = submittedCurrency;
  }

  const db = await getDb();
  // One transaction: the unit and the prose it carries land together or not
  // at all, so a failed conversion leaves the shop on its old unit and a retry
  // still has a switch to make (issue #2683).
  const sites = await db.transaction(async (tx) => {
    const before = await lockShopDepthUnit(tx, session.user.shopId);
    await setShopDepthUnit(tx, session.user.shopId, depthUnit.data);
    const from = before ?? depthUnit.data;
    const result = await convertImportedSiteProseToUnit(
      tx,
      session.user.shopId,
      from,
      depthUnit.data,
    );
    return { ...result, from };
  });
  await setShopTemperatureUnit(db, session.user.shopId, temperatureUnit.data);
  if (currency !== null) {
    await setShopCurrency(db, session.user.shopId, currency);
  }
  // Saving this form *is* the confirmation the setup checklist asks for, even
  // when nothing changed — the step is "look at these", and a shop that opened
  // the row and agreed with the derived values has looked (issue #712).
  await markShopUnitsConfirmed(db, session.user.shopId);
  revalidateAndRedirect(
    settings,
    sites.leftAlone > 0
      ? noticeUrl(settings, "units-saved-sites-left", {
          saved: "units",
          count: sites.leftAlone,
          from: sites.from,
          // The first few by name; the rest are the count's "and more".
          sites: sites.leftAloneNames.slice(0, 3).join(" · "),
        })
      : noticeUrl(settings, "units-saved", { saved: "units" }),
  );
}

/**
 * The address a diver who is not booking yet writes to. Published, so an empty
 * box is a real answer — it takes the "Get in touch" composer off the shop's
 * course pages rather than publishing a blank contact.
 */
/**
 * Sends the shop its confirmation link (issue #1288). Minting supersedes any
 * outstanding link; the email goes to the front-desk address and nowhere else,
 * so opening it is the proof. Degrades like every send: with SES unconfigured
 * the notification resolves `not_configured` and the row simply stays
 * unconfirmed, which costs the shop nothing but Reply-To.
 */
async function sendContactEmailConfirmation(shop: {
  id: string;
  name: string;
  contactEmail: string;
  defaultLocale: string;
  timezone: string;
}): Promise<boolean> {
  const origin = publicAppUrl();
  if (!origin) return false;
  // Per shop and per recipient (security review finding on #1296): the form
  // takes any address and a demo owner login is one click away, so without
  // these a resend loop is a branded-mail relay to a victim's inbox. A refused
  // send leaves the address saved and unconfirmed; the resend control is
  // still there once the bucket refills.
  const [byShop, byRecipient] = await Promise.all([
    checkRateLimit(
      rateLimitKey("contact-confirmation", "shop", shop.id),
      RATE_LIMITS.contactConfirmationByShop,
    ),
    checkRateLimit(
      rateLimitKey("contact-confirmation", "recipient", shop.contactEmail.toLowerCase()),
      RATE_LIMITS.contactConfirmationByRecipient,
    ),
  ]);
  if (!byShop.allowed || !byRecipient.allowed) return false;
  const db = await getDb();
  const issued = await issueShopContactEmailConfirmation(db, {
    shopId: shop.id,
    email: shop.contactEmail,
  });
  const delivery = await sendNotification(db, {
    kind: "address_confirmation",
    purpose: "shop_contact",
    shopId: shop.id,
    tokenId: issued.tokenId,
    to: shop.contactEmail,
    locale: toDiverLocale(shop.defaultLocale),
    shopName: shop.name,
    confirmUrl: new URL(confirmContactLinkPath(issued.token), `${origin}/`).toString(),
    expiresAt: issued.expiresAt,
    timezone: shop.timezone,
  });
  // Only a send that left says "open the email we sent"; an unconfigured
  // provider saves the details and says just that.
  return delivery.status === "sent";
}

export async function saveContactAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(settings, "contact-invalid", { saved: "contact" }));
  const db = await getDb();
  const before = await getShopById(db, session.user.shopId);
  const shop = await setShopContact(db, session.user.shopId, parsed.data);
  // Only an address that actually changed gets a link from a save: it is
  // unconfirmed by construction (setShopContact cleared the proof), and the
  // link is what confirms it. Saving an unchanged, still-unconfirmed address
  // -- a phone edit, say -- sends nothing; the resend control is the one door
  // for that, and it is rate-limited.
  const changed =
    (shop?.contactEmail?.toLowerCase() ?? null) !== (before?.contactEmail?.toLowerCase() ?? null);
  const sent =
    changed && shop?.contactEmail && !shop.contactEmailConfirmedAt
      ? await sendContactEmailConfirmation({ ...shop, contactEmail: shop.contactEmail })
      : false;
  revalidateAndRedirect(
    settings,
    noticeUrl(settings, sent ? "contact-confirmation-sent" : "contact-saved", {
      saved: "contact",
    }),
  );
}

/** The "Resend" tap on an unconfirmed address: a fresh link, the old one superseded. */
export async function resendContactConfirmationAction() {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);
  const shop = await getShopById(await getDb(), session.user.shopId);
  const sent =
    shop?.contactEmail && !shop.contactEmailConfirmedAt
      ? await sendContactEmailConfirmation({ ...shop, contactEmail: shop.contactEmail })
      : false;
  revalidateAndRedirect(
    settings,
    noticeUrl(settings, sent ? "contact-confirmation-sent" : "contact-saved", {
      saved: "contact",
    }),
  );
}

/**
 * Replaces the shop's physical business address with the complete address in
 * the form. Published in structured data so search engines can place the shop
 * as a real venue.
 *
 * Called by the address card's *pick*, not by a Save button — the card is one
 * search box and choosing a place is the whole of the intent (ADR
 * 20260811-address-is-one-search-box). It still takes `FormData` and still
 * revalidates the same schema: a server action's arguments are
 * attacker-controlled whatever calls it, and the same shape keeps the
 * hand-crafted-POST case and the honest one on one path.
 *
 * An all-empty address is the Remove control, and it says so rather than
 * reporting "saved" for a thing that is now gone.
 */
export async function saveAddressAction(formData: FormData): Promise<{ ok: true }> {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);
  const parsed = addressSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(settings, "address-invalid", { saved: "address" }));
  const { latitude, longitude, ...textFields } = parsed.data;
  await setShopAddress(await getDb(), session.user.shopId, {
    ...textFields,
    latitude: typeof latitude === "number" ? latitude : null,
    longitude: typeof longitude === "number" ? longitude : null,
  });
  revalidatePath(settings);
  // AddressSearch is an in-place picker. Returning after the write keeps the
  // settings shell and viewport mounted instead of turning a suggestion tap
  // into a full route navigation; the component already has the exact fields
  // that were just persisted.
  return { ok: true };
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
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);
  const submitted = readForm(timezoneForm, formData).timezone;
  // An id this runtime can't resolve would make every date formatter on every
  // surface throw, so an unrecognized value is a refusal, never a fallback.
  if (typeof submitted !== "string" || !isValidTimeZone(submitted)) {
    redirect(noticeUrl(settings, "timezone-invalid", { saved: "timezone" }));
  }
  await setShopTimezone(await getDb(), session.user.shopId, submitted);
  revalidateAndRedirect(settings, noticeUrl(settings, "timezone-saved", { saved: "timezone" }));
}

/**
 * The shop's season start — the denominator behind the home's one fact of
 * scale (ADR 20260904-reef-all-the-way-down, Budget rule 3).
 *
 * `parseSeasonStart` refuses exactly what the table's CHECK constraints
 * refuse, so a 31 chosen in April is a refusal on the form rather than a
 * clamped 30 the shop never asked for.
 */
export async function saveSeasonStartAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);
  const { seasonStartMonth, seasonStartDay } = readForm(seasonStartForm, formData);
  const season = parseSeasonStart(seasonStartMonth, seasonStartDay);
  if (!season) {
    redirect(noticeUrl(settings, "season-invalid", { saved: "season" }));
  }
  await setShopSeasonStart(await getDb(), session.user.shopId, season);
  revalidateAndRedirect(settings, noticeUrl(settings, "season-saved", { saved: "season" }));
}

/**
 * When the shop is back on the water, for the public page's off-season line
 * (`shops.reopens_on`). Blank clears it; anything that is not a real calendar
 * date is refused on the form rather than stored.
 */
const reopensOnForm = z.object({ reopensOn: trimmedText() });

export async function saveReopensOnAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);
  const submitted = readForm(reopensOnForm, formData).reopensOn;
  if (submitted !== "" && !isValidCalendarDate(submitted)) {
    redirect(noticeUrl(settings, "reopens-invalid", { saved: "season" }));
  }
  const db = await getDb();
  // A typo ("2062") would reach the public schedule; a date more than eighteen
  // months past the shop's today is refused with the same notice. A past date
  // is stored as typed and cleared by the nightly roll.
  if (submitted !== "") {
    const shop = await getShopById(db, session.user.shopId);
    if (shop && reopensOnTooFar(submitted, calendarDateInTimezone(nowDate(), shop.timezone))) {
      redirect(noticeUrl(settings, "reopens-invalid", { saved: "season" }));
    }
  }
  await setShopReopensOn(db, session.user.shopId, submitted === "" ? null : submitted);
  revalidatePath(publicSchedulePath(session.user.shopSlug));
  revalidateAndRedirect(settings, noticeUrl(settings, "reopens-saved", { saved: "season" }));
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
 *
 * A failure carries a `reason` (`src/lib/address-lookup.ts`). It changes
 * nothing a staffer reads — the sentence is the same one either way, and a dive
 * shop cannot act on `AccessDeniedException` — but it is what turns the
 * response body in a developer's network panel from "it says failed" into the
 * name of the deployment mistake. It is a category, never the provider's
 * message.
 */
export async function suggestAddressAction(query: string): Promise<AddressLookupResult> {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonManageShopSettings(db, session.user.shopId, session.user.personId))) {
    // The staffer reads the same sentence either way — the boxes below still
    // work — but the reason separates a demoted actor from a sick geocoder for
    // whoever is looking at the response.
    return { status: "failed", reason: "not_permitted" };
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
  // The ordinary local and self-hosted case, not an error: the card says so
  // in a sentence rather than offering a box that answers nothing.
  if (!config) return { status: "not_configured" };

  // Where to look from. `Suggest` refuses a request with no geographic anchor
  // at all, so this ladder always tries to produce one, best signal first:
  //
  //  1. **A dive site's own coordinate.** The most precise thing this app
  //     holds — a shop's storefront is near the water it takes people to.
  //     Frequently absent, though: the field is the *offshore forecast point*
  //     and is optional ("Leave both blank to keep crew-only conditions"), so
  //     a shop that never wanted marine forecasts has none.
  //  2. **The shop's timezone.** Coarse — a longitude band, not a street — but
  //     `shops.timezone` is `notNull`, so every shop has one. A bias only
  //     ranks and never excludes, which is what makes a rough anchor safe and
  //     still useful: it puts the right region ahead of the wrong hemisphere.
  //
  // Null only for a timezone the anchor table has never placed; the adapter
  // then searches the whole globe rather than inventing a centre.
  const shop = await getShopById(db, session.user.shopId);
  const bias =
    (await shopSearchAnchor(db, session.user.shopId)) ??
    (shop ? timeZoneAnchor(shop.timezone) : null);
  // Never confined to the saved country: this box is how a shop *changes* its
  // address, and a country filter taken from the old one hid every place
  // abroad (Aaron, 2026-10-03: Barefoot Dive Center, Cozumel, from a shop
  // saved in the US). The bias above still ranks the shop's own region first.

  // Imported here rather than at module scope so a deployment with no
  // credentials never loads the AWS SDK at all.
  const { awsAddressLookupProvider } = await import("@/lib/address-lookup-aws");
  return awsAddressLookupProvider(config).suggest(query, { bias });
}
