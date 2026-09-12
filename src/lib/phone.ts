/**
 * The one shape a phone number is **stored** in: E.164 — a `+`, the country's
 * calling code, and digits, with nothing else in it (`+13055550110`).
 *
 * Two readers share the table below. `readTypedPhone`
 * (`src/lib/forgiving-fields.ts`) turns what a staffer typed into the grouped
 * string the field shows back to them; `toE164` turns the same text into the
 * string the row holds. One table, so the field and the database can never
 * disagree about which country a shop is in.
 *
 * **Stored is not displayed, and it is not compared.** The staff surfaces print
 * a grouped reading of the column (`displayStoredPhone`), staff search compares
 * the digits of the query to the digits of the column (`personSearchMatch`,
 * src/db/person-search.ts), and the inbound router matches on the last seven
 * (`src/db/inbound-messages.ts`). Assuming those three are one string is issue
 * #1765: the screen grouped the number, the search box did not, and a staffer
 * pasting what they were looking at found nobody.
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
 * Whether this string is already the stored shape: a `+` and nothing but
 * digits, seven to fifteen of them.
 *
 * What {@link toE164} answers, and therefore what `people.phone` holds for
 * every number DiveDay could resolve. A row holding anything else holds text a
 * writer could not resolve and stored as typed ({@link phoneForStorage}) — an
 * extension, a note, a number typed where there was no calling code to put in
 * front of it — which is why a reader that reshapes a stored number asks this
 * first (`displayStoredPhone`, src/lib/forgiving-fields.ts).
 */
export function isE164(value: string): boolean {
  const digits = value.slice(1);
  // No leading zero, which is not E.164's rule but is the one that keeps this
  // predicate honest about its readers. `readTypedPhone` strips a leading `00`
  // as an international prefix, so `+001234567` would have printed as
  // `+1 234 567` -- two digits shorter than the row, in front of a staffer
  // about to dial it, and the one shape where "this value is E.164, so
  // reshaping it preserves the digits" was false. Unreachable through any
  // writer, since `toE164` strips the `00` before storing, so this closes a
  // disagreement between the guard and the reader rather than a live bug
  // (security review, 2026-09-12).
  if (digits.startsWith("0")) return false;
  return value.startsWith("+") && /^\d+$/.test(digits) && inE164Range(digits);
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
 * person typed when this returns null — that is {@link phoneForStorage}, which
 * is how every writer of `people.phone` reaches this — because an unparseable
 * phone is still the only way that shop can reach that diver, and a number
 * silently blanked or half-rewritten is worse than an odd one.
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

/**
 * The form a number is written into `people.phone`: E.164 when {@link toE164}
 * can read this text, and otherwise the trimmed text exactly as it was typed.
 *
 * This is the *whole* rule for that column, and it is pure so that the writer
 * holding the shop's country already (the CSV importer, which reads the shop
 * once for a file of thousands of rows) and the writer that has to go and fetch
 * it (`storedPhone`, src/db/person-phone.ts) cannot drift apart.
 *
 * Normalising on **write** rather than at each read is what makes the stored
 * string carry its own country instead of the shop's current address setting.
 * `storedPhone` holds that account in full — the incident that forced it and
 * the list of every writer the rule binds — and this is the half of it that a
 * caller can reach without a database.
 */
export function phoneForStorage(
  raw: string | null | undefined,
  country: string | null | undefined,
): string | null {
  const typed = raw?.trim();
  if (!typed) return null;
  return toE164(typed, country) ?? typed;
}
