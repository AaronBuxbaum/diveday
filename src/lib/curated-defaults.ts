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

/**
 * **The euro area, by country** (#2422): the members that price in euros, and
 * the French overseas regions divers fly to, which are in it too. Spanish is a
 * shipped locale, and with London the only European shortcut zone a shop in
 * Spain or Malta started in dollars.
 */
const EURO_COUNTRIES: ReadonlySet<string> = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "DE",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PT",
  "SI",
  "SK",
  "GP",
  "MQ",
  "RE",
  "YT",
  "GF",
  "PM",
  "BL",
  "MF",
  "MC",
  "VA",
  "SM",
  "AD",
  "ME",
]);

/**
 * **Every other zone whose country sets a shop's units, for a shop that has
 * given only its timezone** (#2422, widened in #2571) — which is every shop at
 * sign-up. Not curated shortcuts: the picker still lists every IANA zone; this
 * only says which country each of these is in, so a shop in Zurich, Tokyo or
 * Phoenix does not start in dollars or metres by default.
 *
 * Generated from the IANA `zone.tab` (one country per zone, the canonical
 * location), kept to the countries `COUNTRY_CURRENCY` or `IMPERIAL_COUNTRIES`
 * knows: a zone in a country neither names would read as the same default
 * either way. Where one zone spans countries (`zone1970.tab`), `zone.tab`
 * names the zone's own city's country, which can be a guess; a zone absent
 * from this table, and any alias, falls back to the defaults and the setup
 * checklist asks the shop to confirm.
 */
const ZONE_COUNTRY_BY_IANA: Readonly<Record<string, string>> = {
  // Aliases a browser can still report, which `zone.tab` omits.
  "Europe/Nicosia": "CY",
  "Europe/Belfast": "GB",
  "Asia/Ujung_Pandang": "ID",
  "Europe/Andorra": "AD",
  "Pacific/Pago_Pago": "AS",
  "Europe/Vienna": "AT",
  "Antarctica/Macquarie": "AU",
  "Australia/Adelaide": "AU",
  "Australia/Brisbane": "AU",
  "Australia/Broken_Hill": "AU",
  "Australia/Darwin": "AU",
  "Australia/Eucla": "AU",
  "Australia/Hobart": "AU",
  "Australia/Lindeman": "AU",
  "Australia/Lord_Howe": "AU",
  "Australia/Melbourne": "AU",
  "Australia/Perth": "AU",
  "Australia/Sydney": "AU",
  "Europe/Brussels": "BE",
  "Europe/Sofia": "BG",
  "America/St_Barthelemy": "BL",
  "America/Araguaina": "BR",
  "America/Bahia": "BR",
  "America/Belem": "BR",
  "America/Boa_Vista": "BR",
  "America/Campo_Grande": "BR",
  "America/Cuiaba": "BR",
  "America/Eirunepe": "BR",
  "America/Fortaleza": "BR",
  "America/Maceio": "BR",
  "America/Manaus": "BR",
  "America/Noronha": "BR",
  "America/Porto_Velho": "BR",
  "America/Recife": "BR",
  "America/Rio_Branco": "BR",
  "America/Santarem": "BR",
  "America/Sao_Paulo": "BR",
  "America/Atikokan": "CA",
  "America/Blanc-Sablon": "CA",
  "America/Cambridge_Bay": "CA",
  "America/Creston": "CA",
  "America/Dawson": "CA",
  "America/Dawson_Creek": "CA",
  "America/Edmonton": "CA",
  "America/Fort_Nelson": "CA",
  "America/Glace_Bay": "CA",
  "America/Goose_Bay": "CA",
  "America/Halifax": "CA",
  "America/Inuvik": "CA",
  "America/Iqaluit": "CA",
  "America/Moncton": "CA",
  "America/Rankin_Inlet": "CA",
  "America/Regina": "CA",
  "America/Resolute": "CA",
  "America/St_Johns": "CA",
  "America/Swift_Current": "CA",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
  "America/Whitehorse": "CA",
  "America/Winnipeg": "CA",
  "Europe/Zurich": "CH",
  "Asia/Famagusta": "CY",
  "Asia/Nicosia": "CY",
  "Europe/Berlin": "DE",
  "Europe/Busingen": "DE",
  "Europe/Copenhagen": "DK",
  "America/Guayaquil": "EC",
  "Pacific/Galapagos": "EC",
  "Europe/Tallinn": "EE",
  "Africa/Cairo": "EG",
  "Africa/Ceuta": "ES",
  "Atlantic/Canary": "ES",
  "Europe/Madrid": "ES",
  "Europe/Helsinki": "FI",
  "Pacific/Chuuk": "FM",
  "Pacific/Kosrae": "FM",
  "Pacific/Pohnpei": "FM",
  "Europe/Paris": "FR",
  "Europe/London": "GB",
  "America/Cayenne": "GF",
  "Europe/Guernsey": "GG",
  "America/Guadeloupe": "GP",
  "Europe/Athens": "GR",
  "Pacific/Guam": "GU",
  "Europe/Zagreb": "HR",
  "Asia/Jakarta": "ID",
  "Asia/Jayapura": "ID",
  "Asia/Makassar": "ID",
  "Asia/Pontianak": "ID",
  "Europe/Dublin": "IE",
  "Asia/Jerusalem": "IL",
  "Europe/Isle_of_Man": "IM",
  "Indian/Chagos": "IO",
  "Europe/Rome": "IT",
  "Europe/Jersey": "JE",
  "Asia/Tokyo": "JP",
  "Europe/Vaduz": "LI",
  "Europe/Vilnius": "LT",
  "Europe/Luxembourg": "LU",
  "Europe/Riga": "LV",
  "Europe/Monaco": "MC",
  "Europe/Podgorica": "ME",
  "America/Marigot": "MF",
  "Pacific/Kwajalein": "MH",
  "Pacific/Majuro": "MH",
  "Pacific/Saipan": "MP",
  "America/Martinique": "MQ",
  "Europe/Malta": "MT",
  "America/Bahia_Banderas": "MX",
  "America/Cancun": "MX",
  "America/Chihuahua": "MX",
  "America/Ciudad_Juarez": "MX",
  "America/Hermosillo": "MX",
  "America/Matamoros": "MX",
  "America/Mazatlan": "MX",
  "America/Merida": "MX",
  "America/Mexico_City": "MX",
  "America/Monterrey": "MX",
  "America/Ojinaga": "MX",
  "America/Tijuana": "MX",
  "Asia/Kuala_Lumpur": "MY",
  "Asia/Kuching": "MY",
  "Europe/Amsterdam": "NL",
  "Europe/Oslo": "NO",
  "Pacific/Auckland": "NZ",
  "Pacific/Chatham": "NZ",
  "America/Panama": "PA",
  "Asia/Manila": "PH",
  "America/Miquelon": "PM",
  "America/Puerto_Rico": "PR",
  "Atlantic/Azores": "PT",
  "Atlantic/Madeira": "PT",
  "Europe/Lisbon": "PT",
  "Pacific/Palau": "PW",
  "Indian/Reunion": "RE",
  "Europe/Stockholm": "SE",
  "Asia/Singapore": "SG",
  "Europe/Ljubljana": "SI",
  "Europe/Bratislava": "SK",
  "Europe/San_Marino": "SM",
  "America/El_Salvador": "SV",
  "America/Grand_Turk": "TC",
  "Asia/Bangkok": "TH",
  "Asia/Dili": "TL",
  "Pacific/Midway": "UM",
  "Pacific/Wake": "UM",
  "America/Adak": "US",
  "America/Anchorage": "US",
  "America/Boise": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Detroit": "US",
  "America/Indiana/Indianapolis": "US",
  "America/Indiana/Knox": "US",
  "America/Indiana/Marengo": "US",
  "America/Indiana/Petersburg": "US",
  "America/Indiana/Tell_City": "US",
  "America/Indiana/Vevay": "US",
  "America/Indiana/Vincennes": "US",
  "America/Indiana/Winamac": "US",
  "America/Juneau": "US",
  "America/Kentucky/Louisville": "US",
  "America/Kentucky/Monticello": "US",
  "America/Los_Angeles": "US",
  "America/Menominee": "US",
  "America/Metlakatla": "US",
  "America/New_York": "US",
  "America/Nome": "US",
  "America/North_Dakota/Beulah": "US",
  "America/North_Dakota/Center": "US",
  "America/North_Dakota/New_Salem": "US",
  "America/Phoenix": "US",
  "America/Sitka": "US",
  "America/Yakutat": "US",
  "Pacific/Honolulu": "US",
  "Europe/Vatican": "VA",
  "America/Tortola": "VG",
  "America/St_Thomas": "VI",
  "Indian/Mayotte": "YT",
  "Africa/Johannesburg": "ZA",
};

/**
 * **Countries outside the euro area whose own currency DiveDay offers**
 * (`SHOP_CURRENCIES`), beyond the curated zones' (#2571). The dollarized
 * countries price in US dollars. A country whose currency is not offered (Poland,
 * Czechia, Hungary, Chile, Argentina and the rest) is deliberately absent: it
 * starts in DiveDay's default, as it always did, until the picker offers its
 * own.
 */
const OTHER_COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  CA: "cad",
  AU: "aud",
  NZ: "nzd",
  MX: "mxn",
  BR: "brl",
  TH: "thb",
  ID: "idr",
  PH: "php",
  MY: "myr",
  SG: "sgd",
  JP: "jpy",
  EG: "egp",
  ZA: "zar",
  IL: "ils",
  CH: "chf",
  LI: "chf",
  DK: "dkk",
  NO: "nok",
  SE: "sek",
  GB: "gbp",
  GG: "gbp",
  JE: "gbp",
  IM: "gbp",
  EC: "usd",
  SV: "usd",
  PA: "usd",
  TL: "usd",
  PW: "usd",
  FM: "usd",
  MH: "usd",
  TC: "usd",
  VG: "usd",
  IO: "usd",
  UM: "usd",
};

/** Each known country's currency: the curated zone tables, the euro area, then the rest. */
const COUNTRY_CURRENCY: ReadonlyMap<string, string> = new Map([
  ...Object.entries(OTHER_COUNTRY_CURRENCY),
  ...(Object.keys(ZONE_COUNTRY) as CuratedTimeZone[]).map(
    (zone) => [ZONE_COUNTRY[zone], ZONE_CURRENCY[zone]] as const,
  ),
  ...[...EURO_COUNTRIES].map((country) => [country, "eur"] as const),
]);

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
  const iso =
    typed ?? ZONE_COUNTRY[timeZone as CuratedTimeZone] ?? ZONE_COUNTRY_BY_IANA[timeZone] ?? null;
  const imperial = iso !== null && IMPERIAL_COUNTRIES.has(iso);
  const derived = (iso && COUNTRY_CURRENCY.get(iso)) ?? (imperial ? "usd" : undefined);
  return {
    currency: isShopCurrency(derived) ? derived : DEFAULT_SHOP_CURRENCY,
    depthUnit: imperial ? "feet" : "meters",
    temperatureUnit: imperial ? "fahrenheit" : "celsius",
  };
}

/**
 * **The catalog areas near this shop** — the dive areas whose templates the
 * first-run line may offer it (issue #2477; UX review 2026-10-11, item 15).
 *
 * The address wins when the shop has given one. A country decides alone for
 * an area that is a whole country; where one country holds the area among
 * other places (Florida in the US), the subdivision must match too. Only what
 * the address leaves unsaid falls back to the timezone, and only to a zone the
 * area names as mostly its own, so a New York-zone shop that types a North
 * Carolina address is never offered Florida sites.
 *
 * The areas come in as an argument rather than an import: this module is the
 * framework-free domain layer, and which areas exist is content.
 */
export function catalogAreasForShop<Area extends CatalogArea>(
  shop: { timezone: string; addressCountry?: string | null; addressRegion?: string | null },
  areas: readonly Area[],
): Area[] {
  const country = shop.addressCountry?.trim().toUpperCase() || null;
  const subdivision = shop.addressRegion?.trim().toUpperCase() || null;
  const zoneGuess = (area: CatalogArea) => area.region.timeZones?.includes(shop.timezone) ?? false;
  return areas.filter((area) => {
    const { region } = area;
    if (country && country !== region.country) return false;
    if (!region.subdivisions) return country ? true : zoneGuess(area);
    if (subdivision) return region.subdivisions.includes(subdivision);
    return zoneGuess(area);
  });
}

/** The part of a `src/content/dive-areas.ts` area that decides whether it is near a shop. */
export type CatalogArea = {
  region: {
    country: string;
    subdivisions?: readonly string[];
    timeZones?: readonly string[];
  };
};

/** `shopDefaults` for a shop that has told DiveDay only its timezone (sign-up). */
export function shopDefaultsForTimeZone(timeZone: string): ShopDefaults {
  return shopDefaults({ timeZone });
}
