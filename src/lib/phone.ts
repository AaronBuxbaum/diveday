/**
 * The one shape a phone number is stored and compared in: E.164 — a `+`, the
 * country's calling code, and digits, with nothing else in it
 * (`+13055550110`).
 *
 * Two readers share the table below. `readTypedPhone`
 * (`src/lib/forgiving-fields.ts`) turns what a staffer typed into the grouped
 * string the field shows back to them; `toE164` turns the same text into the
 * string the row holds and every comparison runs on. One table, so the field
 * and the database can never disagree about which country a shop is in.
 *
 * Pure and framework-free: the shop's country arrives as a parameter
 * (`shops.address_country`), never read from anywhere in here.
 */

/** Calling codes for the countries a shop can be in (`shops.address_country`). */
export const CALLING_CODES: Record<string, string> = {
  US: "1",
  CA: "1",
  MX: "52",
  GB: "44",
  AU: "61",
  NZ: "64",
  ES: "34",
  PT: "351",
  FR: "33",
  IT: "39",
  DE: "49",
  NL: "31",
  BE: "32",
  IE: "353",
  TH: "66",
  ID: "62",
  PH: "63",
  MY: "60",
  EG: "20",
  ZA: "27",
  CR: "506",
  HN: "504",
  BZ: "501",
  DO: "1",
  BS: "1",
  JM: "1",
  KY: "1",
  TC: "1",
  VG: "1",
  BB: "1",
  TT: "1",
  MV: "960",
  FJ: "679",
  PF: "689",
  AE: "971",
  BR: "55",
  CO: "57",
  EC: "593",
  CW: "599",
  AW: "297",
  BQ: "599",
};

/** E.164 allows fifteen digits; seven is the shortest national number above. */
function inE164Range(digits: string): boolean {
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * The E.164 form of a number a person typed, read against the shop's own
 * country — or null when this text cannot be resolved into one.
 *
 * Every shape that arrives, and what becomes of it:
 *
 * - `+1 (305) 555-0110`, `00 34 612 345 678` — already international. Taken as
 *   written: the punctuation goes, one leading `00` is read as the `+`, and
 *   the shop's own country is not consulted at all.
 * - `305-555-0110` in a `US` (or `CA`, `BS`, …) shop — the NANP rule: exactly
 *   ten national digits, or eleven with a leading `1`, prefixed with `+1`.
 *   Nine or twelve bare digits is not a North American number and is refused
 *   rather than padded into one.
 * - `0612 345 678` in an `ES` shop — one national trunk `0` comes off and the
 *   shop's calling code goes in front: `+34612345678`.
 * - `612345678` where the shop has **no** country on file, or a country this
 *   table does not carry — null. There is no code to put in front and DiveDay
 *   will not guess one.
 * - fewer than seven or more than fifteen digits, before or after the calling
 *   code goes on — null.
 *
 * **Null is never a licence to drop the number.** Every caller stores what the
 * person typed when this returns null (`createDiver`, `updateDiver`), because
 * an unparseable phone is still the only way that shop can reach that diver,
 * and a number silently blanked or half-rewritten is worse than an odd one.
 */
export function toE164(
  raw: string | null | undefined,
  country: string | null | undefined,
): string | null {
  const text = raw?.trim();
  if (!text) return null;
  const international = text.startsWith("+") || text.startsWith("00");
  const digits = text.replace(/\D/g, "").replace(/^00/, "");
  if (!inE164Range(digits)) return null;
  if (international) return `+${digits}`;
  const home = CALLING_CODES[(country ?? "").toUpperCase()];
  if (!home) return null;
  if (home === "1") {
    const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    return national.length === 10 ? `+1${national}` : null;
  }
  const national = digits.startsWith("0") ? digits.slice(1) : digits;
  const full = `${home}${national}`;
  return inE164Range(full) ? `+${full}` : null;
}
