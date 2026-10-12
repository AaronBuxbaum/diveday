import type { DepthUnit } from "./depth-units";
import { DEFAULT_SHOP_CURRENCY, isShopCurrency, type ShopCurrency } from "./money";
import type { TemperatureUnit } from "./temperature-units";
import type { CuratedTimeZone } from "./timezones";

/**
 * **What a shop's timezone already told us.**
 *
 * `/onboard` asks for exactly five things, and the timezone select is the good
 * one — curated dive-region groups, so a shop in Bonaire or the Maldives finds
 * itself in a tap. Then the shop was created with `usd` and the global default
 * depth unit, so a shop that had just said `America/Cancun` priced in dollars,
 * and a Florida shop — where every briefing and every agency card says 60 ft —
 * was as likely to get metres (issue #712).
 *
 * The recovery is worse than the mistake. `depth_unit` is display-and-entry
 * only, so flipping it later reinterprets nothing — but every number typed
 * while the wrong unit showed was converted on the way in. Currency is
 * stricter: `price_cents` is an integer count of the *current* currency's minor
 * unit, so a `usd → mxn` switch turns 9500 from ninety-five dollars into
 * ninety-five pesos, with no migration.
 *
 * An explicit table, not a locale library: it is two dozen rows, it is
 * auditable, and a wrong guess is visible in the setup checklist rather than
 * buried in a dependency.
 */

/** The currency a shop in this zone would price in, if DiveDay offers it. */
export const ZONE_CURRENCY: Record<CuratedTimeZone, string> = {
  "America/New_York": "usd",
  "America/Chicago": "usd",
  "America/Denver": "usd",
  "America/Los_Angeles": "usd",
  "Pacific/Honolulu": "usd",
  "America/Cancun": "mxn",
  "America/Belize": "bzd",
  "America/Tegucigalpa": "hnl",
  "America/Cayman": "kyd",
  "America/Nassau": "bsd",
  // Puerto Rico is a US territory and prices in dollars — not an exemption, an
  // ordinary match.
  "America/Puerto_Rico": "usd",
  "America/Curacao": "ang",
  "Europe/London": "gbp",
  "Africa/Cairo": "egp",
  "Indian/Maldives": "mvr",
  "Asia/Bangkok": "thb",
  "Asia/Jakarta": "idr",
  "Asia/Singapore": "sgd",
  "Asia/Makassar": "idr",
  "Asia/Manila": "php",
  // Palau uses the US dollar as its own currency; same ordinary match.
  "Pacific/Palau": "usd",
  "Pacific/Fiji": "fjd",
  "Australia/Sydney": "aud",
  "Pacific/Auckland": "nzd",
};

/**
 * **Zones whose local currency DiveDay deliberately does not offer, and why.**
 *
 * Every one of these is the same reason, checked against Stripe's own published
 * list of the 50 countries it supports for accepting payments (2026-08-22):
 * **Stripe does not operate in these countries at all.** Not "does not settle
 * this currency" — a dive shop in Roatán or Malé cannot open a Stripe connected
 * account in any currency, so adding HNL or MVR to the picker would offer a
 * shop money it can never be paid in, and `canAcceptPayments` would refuse its
 * checkout regardless.
 *
 * **The zones stay, and that is the point.** DiveDay is not a payments product
 * with a schedule attached: a shop that takes cash at the counter uses the
 * board, the manifests, the waivers and the readiness gates, and it still needs
 * its clock right. Dropping `Indian/Maldives` from the shortcut because Stripe
 * has not reached the Maldives would break a shop that never wanted online
 * payment in the first place — and the timezone picker is about *time*.
 *
 * If Stripe reaches any of these, the fix is one line in `SHOP_CURRENCIES` and
 * one deletion here.
 */
export const NO_LOCAL_CURRENCY: Partial<Record<CuratedTimeZone, string>> = {
  "America/Belize": "Stripe does not operate in Belize, so no shop there can settle in BZD.",
  "America/Tegucigalpa":
    "Stripe does not operate in Honduras (Roatán, Utila), so no shop there can settle in HNL.",
  "America/Cayman":
    "Stripe does not operate in the Cayman Islands, so no shop there can settle in KYD.",
  "America/Nassau": "Stripe does not operate in the Bahamas, so no shop there can settle in BSD.",
  "America/Curacao": "Stripe does not operate in Curaçao, so no shop there can settle in ANG.",
  "Indian/Maldives": "Stripe does not operate in the Maldives, so no shop there can settle in MVR.",
  "Pacific/Fiji": "Stripe does not operate in Fiji, so no shop there can settle in FJD.",
};

/** The country each curated zone is in (ISO 3166-1 alpha-2). */
export const ZONE_COUNTRY: Record<CuratedTimeZone, string> = {
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Los_Angeles": "US",
  "Pacific/Honolulu": "US",
  "America/Cancun": "MX",
  "America/Belize": "BZ",
  "America/Tegucigalpa": "HN",
  "America/Cayman": "KY",
  "America/Nassau": "BS",
  "America/Puerto_Rico": "PR",
  "America/Curacao": "CW",
  "Europe/London": "GB",
  "Africa/Cairo": "EG",
  "Indian/Maldives": "MV",
  "Asia/Bangkok": "TH",
  "Asia/Jakarta": "ID",
  "Asia/Singapore": "SG",
  "Asia/Makassar": "ID",
  "Asia/Manila": "PH",
  "Pacific/Palau": "PW",
  "Pacific/Fiji": "FJ",
  "Australia/Sydney": "AU",
  "Pacific/Auckland": "NZ",
};

/** Each curated country's currency, read off the zone tables above. */
const COUNTRY_CURRENCY: ReadonlyMap<string, string> = new Map(
  (Object.keys(ZONE_COUNTRY) as CuratedTimeZone[]).map((zone) => [
    ZONE_COUNTRY[zone],
    ZONE_CURRENCY[zone],
  ]),
);

/**
 * **Where a dive briefing is given in feet, and the water in Fahrenheit.**
 *
 * Deliberately narrow: the US and its territories, where feet is the standard
 * unit on the boat, the agency card and the dive computer, and the water
 * temperature is read in Fahrenheit. Everywhere else gets metres and Celsius,
 * which is the rest of the diving world's units and DiveDay's storage units
 * besides.
 *
 * It is tempting to widen this to the Caribbean, where shops serving US divers
 * often brief in feet — and that is exactly the guess this table should not
 * make. A shop in Cozumel briefing in metres would silently have its typed
 * depths tripled, and the checklist step exists to catch the ones the table
 * gets wrong rather than to be right about every shop on earth.
 */
const IMPERIAL_COUNTRIES: ReadonlySet<string> = new Set(["US", "PR", "GU", "VI", "AS", "MP"]);

export type ShopDefaults = {
  currency: ShopCurrency;
  depthUnit: DepthUnit;
  temperatureUnit: TemperatureUnit;
};

/**
 * **The one rule for a shop's starting units**: depth, water temperature and
 * currency all follow the shop's country (US → feet, Fahrenheit, dollars; most
 * others metric). A shop that has told DiveDay only its timezone — sign-up asks
 * for nothing else — gets the country that zone is in. A country or zone the
 * tables do not know falls back to metres, Celsius and DiveDay's default
 * currency, which the setup checklist then asks the shop to confirm.
 *
 * A zone on `NO_LOCAL_CURRENCY` also falls back to USD, and that is the honest
 * answer rather than a gap: Stripe does not operate in those countries at all,
 * so a shop there cannot settle in its own currency whatever DiveDay offers.
 */
export function shopDefaults({
  country,
  timeZone,
}: {
  country?: string | null;
  timeZone: string;
}): ShopDefaults {
  const typed = country?.trim().toUpperCase() || null;
  const iso = typed ?? ZONE_COUNTRY[timeZone as CuratedTimeZone] ?? null;
  const imperial = iso !== null && IMPERIAL_COUNTRIES.has(iso);
  const derived = (iso && COUNTRY_CURRENCY.get(iso)) ?? (imperial ? "usd" : undefined);
  return {
    currency: isShopCurrency(derived) ? derived : DEFAULT_SHOP_CURRENCY,
    depthUnit: imperial ? "feet" : "meters",
    temperatureUnit: imperial ? "fahrenheit" : "celsius",
  };
}

/** `shopDefaults` for a shop that has told DiveDay only its timezone (sign-up). */
export function shopDefaultsForTimeZone(timeZone: string): ShopDefaults {
  return shopDefaults({ timeZone });
}
