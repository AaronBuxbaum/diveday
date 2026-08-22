import { describe, expect, it } from "vitest";
import { isShopCurrency, SHOP_CURRENCIES } from "./money";
import { CURATED_TIMEZONE_GROUPS, type CuratedTimeZone } from "./timezones";

/**
 * **Two curated lists describe the same imagined shop, and they must agree
 * about where it can be** (issue #682).
 *
 * `CURATED_TIMEZONE_GROUPS` exists so a shop in Bonaire, Roatán, Raja Ampat,
 * the Maldives or Fiji can finish signing up without hunting through every IANA
 * zone. `SHOP_CURRENCIES` is curated on the same principle — "every entry is
 * somewhere dive shops actually operate". Seven curated zones had no currency
 * on that list, and `toShopCurrency` silently reads an unrecognised value back
 * as `usd`, so nothing anywhere errored: the shop just priced in dollars.
 *
 * This is the guard that stops the two drifting apart again. Every curated zone
 * either has its country's currency on the picker, or sits below with a written
 * reason.
 */

/** The currency a shop in this zone would price in, if DiveDay offers it. */
const ZONE_CURRENCY: Record<CuratedTimeZone, string> = {
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
const NO_LOCAL_CURRENCY: Partial<Record<CuratedTimeZone, string>> = {
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

const curatedZones = CURATED_TIMEZONE_GROUPS.flatMap((group) => [...group.zones]);

describe("the curated timezone shortcuts and the currency picker", () => {
  it("offer a currency for every zone, or say why not", () => {
    const unexplained = curatedZones.filter(
      (zone) => !isShopCurrency(ZONE_CURRENCY[zone]) && !NO_LOCAL_CURRENCY[zone],
    );
    expect(unexplained).toEqual([]);
  });

  it("gives every exemption a written reason", () => {
    for (const [zone, reason] of Object.entries(NO_LOCAL_CURRENCY)) {
      expect(reason, zone).toMatch(/Stripe|USD|dollar/);
      expect(reason.length, zone).toBeGreaterThan(30);
    }
  });

  it("keeps no exemption for a currency the picker actually has", () => {
    // The half that makes this a ratchet rather than a rug: the day a currency
    // is added, its exemption has to go, or the list rots into a record of
    // decisions nobody re-made.
    const stale = Object.keys(NO_LOCAL_CURRENCY).filter((zone) =>
      isShopCurrency(ZONE_CURRENCY[zone as CuratedTimeZone]),
    );
    expect(stale).toEqual([]);
  });

  it("names a currency for every curated zone", () => {
    // `ZONE_CURRENCY` is typed `Record<CuratedTimeZone, …>`, so a new shortcut
    // zone is a compile error rather than a silent gap — this asserts the
    // runtime shape too, since the table is hand-written.
    expect(curatedZones.filter((zone) => !ZONE_CURRENCY[zone])).toEqual([]);
  });

  it("still offers the currencies the picker is built around", () => {
    // A sanity floor: this test would also pass on an empty currency list.
    for (const currency of ["usd", "eur", "gbp", "mxn", "thb", "idr", "aud", "nzd", "egp"]) {
      expect(SHOP_CURRENCIES).toContain(currency);
    }
  });
});
