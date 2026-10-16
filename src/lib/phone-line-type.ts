import { parsePhoneNumberFromString } from "libphonenumber-js/mobile";

/**
 * **Whether a stored number is a line a text reaches** (Aaron, 2026-10-13,
 * issue #2289; ADR 20261014-phone-line-type-metadata).
 *
 * The counter QR's country gate (`homeNumberingArea`, src/lib/phone.ts) reads
 * only the calling code, and for `+1` the area code. Inside a non-NANP home
 * country that still lets a premium or landline range count as home: a UK 09
 * number bills the shop premium rates, a Spanish 80x or 90x number is a
 * premium or shared-cost line, and a landline never shows the text at all.
 *
 * So this reads the line type from libphonenumber's metadata, and only a
 * mobile line passes. The `mobile` build is the smallest that knows line
 * types: it carries the mobile patterns and nothing else, and answers
 * `MOBILE` for a mobile number and for a NANP number, where landlines and
 * mobiles share every range (libphonenumber's FIXED_LINE_OR_MOBILE). Anything
 * else, unknown included, is refused, which fails toward not texting: the
 * registrant is still stored and the shop sends the release itself.
 *
 * A module of its own rather than a line in `phone.ts`: that file's calling
 * code table is read in the browser (`src/lib/forgiving-fields.ts`), and the
 * metadata is about 100 kB the browser has no use for. This is read only on
 * the server, by `selfRegistrationReleaseDelivery`.
 */
export function canReceiveText(e164: string): boolean {
  const number = parsePhoneNumberFromString(e164);
  if (!number) return false;
  const type = number.getType();
  return type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE";
}
