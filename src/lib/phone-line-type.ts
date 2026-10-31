import { parsePhoneNumberFromString } from "libphonenumber-js/mobile";
import { CALLING_CODES } from "./phone";

/**
 * **Whether a stored number is a line a text reaches** (Aaron, 2026-10-13,
 * issue #2289; ADR 20261014-phone-line-type-metadata).
 *
 * The counter QR's country gate (`homeNumberingArea`, below) reads the calling
 * code and, for `+1`, the country the metadata assigns the number to. Inside a
 * non-NANP home country the calling code still lets a premium or landline
 * range count as home: a UK 09 number bills the shop premium rates, a Spanish
 * 80x or 90x number is a premium or shared-cost line, and a landline never
 * shows the text at all.
 *
 * So this reads the line type from libphonenumber's metadata, and only a
 * mobile line passes. The `mobile` build is the smallest that knows line
 * types: it carries the mobile patterns and nothing else, and answers
 * `MOBILE` for a mobile number and for a NANP number, where landlines and
 * mobiles share every range, so for `+1` the line type says nothing and
 * `homeNumberingArea` carries the exclusions. Anything
 * else, unknown included, is refused, which fails toward not texting: the
 * registrant is still stored and the shop sends the release itself.
 *
 * A module of its own rather than a line in `phone.ts`: that file's calling
 * code table is read in the browser (`src/lib/forgiving-fields.ts`), and the
 * metadata is about 100 kB the browser has no use for. This is read only on
 * the server, by `selfRegistrationReleaseDelivery` (and never from a module a
 * client component imports, which is why `anonymousTextRecipient` lives there).
 */
export function canReceiveText(e164: string): boolean {
  if (inLaggingNanpArea(e164)) return true;
  const number = parsePhoneNumberFromString(e164);
  if (!number) return false;
  const type = number.getType();
  return type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE";
}

/**
 * Area codes North American Numbering Plan Administrator (NANPA) has assigned
 * and put in service that the installed `libphonenumber-js` metadata (1.13.15)
 * does not know yet, so `isValid()` refuses every number in them. The old
 * hand-kept table accepted these, so dropping them would turn newly issued
 * phones in new overlays away as "foreign" (review finding M3). Source:
 * https://nationalnanpa.com/ area-code assignments. No newer release is
 * installed to refresh from; delete an entry once the package knows it (the
 * test "lags the metadata" fails when it does). Colorado 983 is in the list
 * because the metadata knows only part of its exchanges (600 to 699 are missing).
 */
export const LAGGING_NANP_AREA_CODES: Readonly<Record<string, readonly string[]>> = {
  US: ["357", "436", "471", "624", "679", "861", "983"],
  CA: ["387", "460"],
};

/**
 * Whether a `+1` number is in one of `LAGGING_NANP_AREA_CODES`, with the
 * shape the plan gives a subscriber number: ten digits, area code and
 * exchange starting 2 to 9, the exchange not N11. The line type cannot tell a
 * NANP mobile from a landline anyway, so structure is all there is to check.
 */
function inLaggingNanpArea(e164: string, country?: string): boolean {
  const match = e164.match(/^\+1([2-9]\d{2})([2-9]\d{2})\d{4}$/);
  if (!match || match[2].endsWith("11")) return false;
  const [, area] = match;
  return Object.entries(LAGGING_NANP_AREA_CODES).some(
    ([code, areas]) => (country === undefined || code === country) && areas.includes(area),
  );
}

/**
 * Whether an E.164 number is in the shop's own country: under its calling
 * code and, for a `+1` country, a number the metadata assigns to that country
 * (issue #3249, replacing a hand-kept area-code table).
 *
 * `"foreign_code"` for another calling code, `"foreign_area_code"` for a `+1`
 * number in another NANP country or in none, and `"home"` otherwise. A country
 * with no calling code in `CALLING_CODES` is `"foreign_code"`: there is no home
 * to be in.
 *
 * `+1` is the US, Canada and some twenty Caribbean and Pacific territories,
 * and a Jamaican (876) or Dominican (809, 829, 849) number is the classic
 * SMS-pumping target, so a `+1` number counts as home only when the parsed
 * number is valid *and* its resolved country is exactly the shop's. The `mobile`
 * build resolves no country for the premium 900/976, toll-free 8XX and personal
 * 5XX ranges, a code nobody has been assigned, or a wrong length, so all of
 * those refuse; US territories (787, 671, 340, ...) resolve to their own
 * country codes, not `US`. Anything the metadata cannot place refuses, which
 * fails toward not texting. A newly assigned code the installed metadata does not know
 * yet is refused until the package is updated, unless it is in
 * `LAGGING_NANP_AREA_CODES`.
 */
export function homeNumberingArea(
  e164: string,
  country: string | null | undefined,
): "home" | "foreign_code" | "foreign_area_code" {
  const code = (country ?? "").toUpperCase();
  const home = CALLING_CODES[code];
  if (!home || !e164.startsWith(`+${home}`)) return "foreign_code";
  if (home !== "1") return "home";
  if (inLaggingNanpArea(e164, code)) return "home";
  const number = parsePhoneNumberFromString(e164);
  return number?.isValid() && number.country === code ? "home" : "foreign_area_code";
}
