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

/**
 * **Which `+1` area codes are in each North American Numbering Plan country**
 * (issue #2151).
 *
 * `+1` is not one country. It is the US, Canada and some twenty Caribbean and
 * Pacific territories, so "the shop's calling code" lets a US shop's counter
 * QR text a premium-rate Jamaican (876) or Dominican (809, 829, 849) number:
 * the classic SMS-pumping target, where whoever owns the number is paid a
 * share of every message the shop is billed for. A gate that has to keep a
 * stranger's choice of recipient inside the shop's own country therefore reads
 * the area code too.
 *
 * Positive lists, deliberately. The US and Canadian rows are the geographic
 * area codes assigned to each (NANPA), so anything not listed is refused:
 * premium 900 and 976, toll-free 8XX, personal 5XX, the Caribbean, and the US
 * territories that SMS providers route and bill as their own countries
 * (Puerto Rico 787/939, the US Virgin Islands 340, Guam 671, the Northern
 * Marianas 670, American Samoa 684). A code assigned after this list was
 * written is refused until it is added, which fails toward not texting: the
 * registrant is still stored and the shop can send the release itself.
 *
 * Only for the countries `CALLING_CODES` gives `1`; a country missing here
 * reads as no list, and the caller refuses.
 */
export const NANP_AREA_CODES: Readonly<Record<string, ReadonlySet<string>>> = {
  US: new Set([
    "201",
    "202",
    "203",
    "205",
    "206",
    "207",
    "208",
    "209",
    "210",
    "212",
    "213",
    "214",
    "215",
    "216",
    "217",
    "218",
    "219",
    "220",
    "223",
    "224",
    "225",
    "227",
    "228",
    "229",
    "231",
    "234",
    "235",
    "239",
    "240",
    "248",
    "251",
    "252",
    "253",
    "254",
    "256",
    "260",
    "262",
    "267",
    "269",
    "270",
    "272",
    "274",
    "276",
    "279",
    "281",
    "283",
    "301",
    "302",
    "303",
    "304",
    "305",
    "307",
    "308",
    "309",
    "310",
    "312",
    "313",
    "314",
    "315",
    "316",
    "317",
    "318",
    "319",
    "320",
    "321",
    "323",
    "324",
    "325",
    "326",
    "327",
    "329",
    "330",
    "331",
    "332",
    "334",
    "336",
    "337",
    "339",
    "341",
    "346",
    "347",
    "350",
    "351",
    "352",
    "353",
    "357",
    "360",
    "361",
    "363",
    "364",
    "369",
    "380",
    "385",
    "386",
    "401",
    "402",
    "404",
    "405",
    "406",
    "407",
    "408",
    "409",
    "410",
    "412",
    "413",
    "414",
    "415",
    "417",
    "419",
    "423",
    "424",
    "425",
    "430",
    "432",
    "434",
    "435",
    "436",
    "440",
    "442",
    "443",
    "445",
    "447",
    "448",
    "458",
    "463",
    "464",
    "469",
    "470",
    "471",
    "472",
    "475",
    "478",
    "479",
    "480",
    "484",
    "501",
    "502",
    "503",
    "504",
    "505",
    "507",
    "508",
    "509",
    "510",
    "512",
    "513",
    "515",
    "516",
    "517",
    "518",
    "520",
    "530",
    "531",
    "534",
    "539",
    "540",
    "541",
    "551",
    "557",
    "559",
    "561",
    "562",
    "563",
    "564",
    "567",
    "570",
    "571",
    "572",
    "573",
    "574",
    "575",
    "580",
    "582",
    "585",
    "586",
    "601",
    "602",
    "603",
    "605",
    "606",
    "607",
    "608",
    "609",
    "610",
    "612",
    "614",
    "615",
    "616",
    "617",
    "618",
    "619",
    "620",
    "623",
    "624",
    "626",
    "628",
    "629",
    "630",
    "631",
    "636",
    "640",
    "641",
    "645",
    "646",
    "650",
    "651",
    "656",
    "657",
    "659",
    "660",
    "661",
    "662",
    "667",
    "669",
    "678",
    "679",
    "680",
    "681",
    "682",
    "686",
    "689",
    "701",
    "702",
    "703",
    "704",
    "706",
    "707",
    "708",
    "712",
    "713",
    "714",
    "715",
    "716",
    "717",
    "718",
    "719",
    "720",
    "724",
    "725",
    "726",
    "727",
    "728",
    "730",
    "731",
    "732",
    "734",
    "737",
    "740",
    "743",
    "747",
    "754",
    "757",
    "760",
    "762",
    "763",
    "765",
    "769",
    "770",
    "771",
    "772",
    "773",
    "774",
    "775",
    "779",
    "781",
    "785",
    "786",
    "801",
    "802",
    "803",
    "804",
    "805",
    "806",
    "808",
    "810",
    "812",
    "813",
    "814",
    "815",
    "816",
    "817",
    "818",
    "820",
    "821",
    "826",
    "828",
    "830",
    "831",
    "832",
    "835",
    "838",
    "839",
    "840",
    "843",
    "845",
    "847",
    "848",
    "850",
    "854",
    "856",
    "857",
    "858",
    "859",
    "860",
    "861",
    "862",
    "863",
    "864",
    "865",
    "870",
    "872",
    "878",
    "901",
    "903",
    "904",
    "906",
    "907",
    "908",
    "909",
    "910",
    "912",
    "913",
    "914",
    "915",
    "916",
    "917",
    "918",
    "919",
    "920",
    "925",
    "928",
    "929",
    "930",
    "931",
    "934",
    "936",
    "937",
    "938",
    "940",
    "941",
    "943",
    "945",
    "947",
    "948",
    "949",
    "951",
    "952",
    "954",
    "956",
    "959",
    "970",
    "971",
    "972",
    "973",
    "975",
    "978",
    "979",
    "980",
    "983",
    "984",
    "985",
    "986",
    "989",
  ]),
  CA: new Set([
    "204",
    "226",
    "236",
    "249",
    "250",
    "257",
    "263",
    "289",
    "306",
    "343",
    "354",
    "365",
    "367",
    "368",
    "382",
    "387",
    "403",
    "416",
    "418",
    "428",
    "431",
    "437",
    "438",
    "450",
    "460",
    "468",
    "474",
    "506",
    "514",
    "519",
    "548",
    "579",
    "581",
    "584",
    "587",
    "604",
    "613",
    "639",
    "647",
    "672",
    "683",
    "705",
    "709",
    "742",
    "753",
    "778",
    "780",
    "782",
    "807",
    "819",
    "825",
    "867",
    "873",
    "879",
    "902",
    "905",
    "942",
  ]),
  DO: new Set(["809", "829", "849"]),
  BS: new Set(["242"]),
  JM: new Set(["876", "658"]),
  KY: new Set(["345"]),
  TC: new Set(["649"]),
  VG: new Set(["284"]),
  BB: new Set(["246"]),
  TT: new Set(["868"]),
};

/**
 * Whether an E.164 number is in the shop's own country: under its calling
 * code and, for a `+1` country, under one of its own area codes
 * ({@link NANP_AREA_CODES}). `"foreign_code"` for another calling code,
 * `"foreign_area_code"` for a `+1` number in another NANP country or in none,
 * and `"home"` otherwise. A country with no calling code here is
 * `"foreign_code"`: there is no home to be in.
 */
export function homeNumberingArea(
  e164: string,
  country: string | null | undefined,
): "home" | "foreign_code" | "foreign_area_code" {
  const code = (country ?? "").toUpperCase();
  const home = CALLING_CODES[code];
  if (!home || !e164.startsWith(`+${home}`)) return "foreign_code";
  if (home !== "1") return "home";
  const areaCode = e164.slice(2, 5);
  return e164.length === 12 && NANP_AREA_CODES[code]?.has(areaCode) ? "home" : "foreign_area_code";
}

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
