import { describe, expect, it } from "vitest";
import { NO_LOCAL_CURRENCY, shopDefaultsForTimeZone, ZONE_CURRENCY } from "./curated-defaults";
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
 * either has its country's currency on the picker, or carries a written reason.
 *
 * The two tables moved into `./curated-defaults.ts` when onboarding started
 * deriving a shop's currency from them (issue #712) — a derivation and its
 * guard must read the same rows, or the guard is describing a table nobody
 * uses.
 */

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

/**
 * **The derivation, which is why the tables above are production code now.**
 *
 * A shop that has just told DiveDay it is in `America/Cancun` should not be
 * created pricing in dollars (issue #712).
 */
describe("what a shop's timezone starts it on", () => {
  it("prices a Cozumel shop in pesos and a Florida shop in feet", () => {
    expect(shopDefaultsForTimeZone("America/Cancun")).toEqual({
      currency: "mxn",
      depthUnit: "meters",
    });
    expect(shopDefaultsForTimeZone("America/New_York")).toEqual({
      currency: "usd",
      depthUnit: "feet",
    });
  });

  it("falls back to USD where Stripe cannot reach, rather than leaving a gap", () => {
    // Not a shortcoming of the table: a shop in Roatán or Malé cannot open a
    // connected account in any currency, so its own currency is not on the
    // picker and USD is the honest starting point. The exemption list above is
    // what records that.
    for (const zone of Object.keys(NO_LOCAL_CURRENCY)) {
      expect(shopDefaultsForTimeZone(zone).currency, zone).toBe("usd");
    }
  });

  it("leaves a zone outside the curated shortcuts on today's defaults", () => {
    // The picker still offers every IANA zone; only the shortcuts are curated.
    expect(shopDefaultsForTimeZone("Europe/Warsaw")).toEqual({
      currency: "usd",
      depthUnit: "meters",
    });
  });

  it("only ever derives a currency the picker actually offers", () => {
    // The whole table, not a sample: deriving `hnl` would store a currency
    // `toShopCurrency` reads back as `usd`, which is the silent failure the
    // guard above exists to prevent, arriving through a different door.
    for (const zone of curatedZones) {
      expect(SHOP_CURRENCIES, zone).toContain(shopDefaultsForTimeZone(zone).currency);
    }
  });

  it("gives every curated zone a depth unit its divers would recognise", () => {
    // Feet only where it is the standard on the boat and the agency card.
    const feet = curatedZones.filter((zone) => shopDefaultsForTimeZone(zone).depthUnit === "feet");
    expect(feet.sort()).toEqual([
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/New_York",
      "America/Puerto_Rico",
      "Pacific/Honolulu",
    ]);
  });
});
