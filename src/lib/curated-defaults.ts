import type { DepthUnit } from "./depth-units";
import { DEFAULT_SHOP_CURRENCY, isShopCurrency, type ShopCurrency } from "./money";
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

/**
 * **Where a dive briefing is given in feet.**
 *
 * Deliberately narrow: the US and its territories, where feet is the standard
 * unit on the boat, the agency card and the dive computer. Everywhere else gets
 * metres, which is the rest of the diving world's unit and DiveDay's storage
 * unit besides.
 *
 * It is tempting to widen this to the Caribbean, where shops serving US divers
 * often brief in feet — and that is exactly the guess this table should not
 * make. A shop in Cozumel briefing in metres would silently have its typed
 * depths tripled, and the checklist step exists to catch the ones the table
 * gets wrong rather than to be right about every shop on earth.
 */
const FEET_ZONES: ReadonlySet<string> = new Set([
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Pacific/Honolulu",
  "America/Puerto_Rico",
]);

/**
 * The currency and depth unit to start a shop on, from the timezone it just
 * chose. A zone the tables do not know — anything outside the curated
 * shortcuts, since the picker still offers every IANA zone — falls back to
 * today's defaults, unchanged.
 *
 * A zone on `NO_LOCAL_CURRENCY` also falls back to USD, and that is the honest
 * answer rather than a gap: Stripe does not operate in those countries at all,
 * so a shop there cannot settle in its own currency whatever DiveDay offers.
 */
export function shopDefaultsForTimeZone(timeZone: string): {
  currency: ShopCurrency;
  depthUnit: DepthUnit;
} {
  const derived = ZONE_CURRENCY[timeZone as CuratedTimeZone];
  return {
    currency: isShopCurrency(derived) ? derived : DEFAULT_SHOP_CURRENCY,
    depthUnit: FEET_ZONES.has(timeZone) ? "feet" : "meters",
  };
}
