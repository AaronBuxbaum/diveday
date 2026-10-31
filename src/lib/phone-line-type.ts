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
  const number = parsePhoneNumberFromString(e164);
  if (!number) return false;
  const type = number.getType();
  return type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE";
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
 * fails toward not texting. A newly assigned code that the installed metadata
 * does not know yet is refused until the package is updated.
 */
export function homeNumberingArea(
  e164: string,
  country: string | null | undefined,
): "home" | "foreign_code" | "foreign_area_code" {
  const code = (country ?? "").toUpperCase();
  const home = CALLING_CODES[code];
  if (!home || !e164.startsWith(`+${home}`)) return "foreign_code";
  if (home !== "1") return "home";
  const number = parsePhoneNumberFromString(e164);
  return number?.isValid() && number.country === code ? "home" : "foreign_area_code";
}
