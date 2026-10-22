/**
 * **Facts come from the record, never from the model** (build plan, "Claude
 * assists": copywriter, site-brief, monday, recap). A drafted sentence names a
 * fact by a placeholder (`{maxDepth}`), and this fills it from the value the
 * caller read off the row. Text that writes a digit of its own, or names a
 * placeholder the caller did not offer, is refused whole: a draft with one
 * invented depth in it is worse than no draft.
 */

const PLACEHOLDER = /\{([A-Za-z][\w.:-]*)\}/g;

/** Every placeholder the text names, in order, repeats included. */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
}

/**
 * The text with each `{key}` replaced by `facts[key]`, or null when the text
 * names a key `facts` does not hold or carries a digit outside a placeholder.
 */
export function fillFacts(text: string, facts: Readonly<Record<string, string>>): string | null {
  let unknown = false;
  const bare = text.replace(PLACEHOLDER, (_whole, key: string) => {
    if (!Object.hasOwn(facts, key)) unknown = true;
    return "";
  });
  if (unknown || /\p{Nd}/u.test(bare)) return null;
  return text.replace(PLACEHOLDER, (_whole, key: string) => facts[key] ?? "").trim();
}

/**
 * A number in a text, read as one whole token of one kind. "8:00 AM" is one
 * time, never an 8 and a 00; "Oct 24" is one date; "$95.00" is one price;
 * "+1 305-555-0100" is one phone number. Only what is left is a plain count.
 * A number is matched only against numbers of its own kind, so "8 seats"
 * cannot borrow the 8 of "8:00" and "8:30" cannot borrow the 30 of "1:30".
 *
 * This is a conservative check, not a parser: anything it cannot read as a
 * whole time, date or price is a plain count, and a plain count the source
 * does not hold is refused. A doubtful draft is thrown away, never kept. It
 * does not tie a number to the departure its sentence names: "3 seats" on the
 * wreck passes if the reef has 3 seats. A staffer still reads every draft.
 */
type NumberToken =
  | { kind: "phone"; digits: string }
  | { kind: "price"; cents: number }
  | { kind: "time"; hour12: number; minute: number; half: "am" | "pm" | null }
  | { kind: "date"; month: number; day: number }
  /** A day of the month with no month: "the 24th", or "10/24" read either way. */
  | { kind: "day"; days: readonly { month: number | null; day: number }[] }
  /** "9 h": an hour of the day or a number of hours, so it may stand for either. */
  | { kind: "hour"; hour: number }
  | { kind: "count"; value: string };

/** Spaces a formatter may put inside a number, a price or a date. */
const SP = "[ \\u00a0\\u202f]";
const MERIDIEM = `${SP}?([ap])\\.?${SP}?m\\.?(?![\\p{L}])`;
// i18n-exempt: currency markers the reader looks for, never shown
const CURRENCY_WORD = "dollars?|d[oó]lares|pesos|euros?|usd|eur|mxn|gbp|cad|aud";
const CURRENCY_MARK = `(?:\\p{Lu}{0,3}[$€£¥]\\p{Lu}{0,3}|(?:${CURRENCY_WORD})(?![\\p{L}]))`;
const AMOUNT = `\\p{Nd}{1,3}(?:[,.${SP.slice(1, -1)}]\\p{Nd}{3})+(?:[.,]\\p{Nd}{1,2})?|\\p{Nd}+(?:[.,]\\p{Nd}{1,2})?`;

/** Month names and short forms, English and Spanish, to their number. */
const MONTHS: readonly (readonly [number, string])[] = [
  // i18n-exempt: month names the reader looks for, never shown
  [1, "jan(?:uary)?|ene(?:ro)?"],
  [2, "feb(?:ruary|rero)?"],
  [3, "mar(?:ch|zo)?"],
  [4, "apr(?:il)?|abr(?:il)?"],
  [5, "may(?:o)?"],
  [6, "jun(?:e|io)?"],
  [7, "jul(?:y|io)?"],
  [8, "aug(?:ust)?|ago(?:sto)?"],
  [9, "sept?(?:ember|iembre)?|set(?:iembre)?"],
  [10, "oct(?:ober|ubre)?"],
  [11, "nov(?:ember|iembre)?"],
  [12, "dec(?:ember)?|dic(?:iembre)?"],
];
const MONTH = `(${MONTHS.map(([, names]) => names).join("|")})\\.?`;

function monthNumber(name: string): number {
  const lower = name.toLowerCase();
  for (const [month, names] of MONTHS) {
    if (new RegExp(`^(?:${names})$`, "u").test(lower)) return month;
  }
  return 0;
}

/** "1,234.50", "1.234,50", "1 234,50" and "95" to cents; the last separator followed by one or two digits is the decimal one. */
function amountCents(text: string): number {
  const compact = text.replace(/[   ]/gu, "");
  const decimal = /[.,](\p{Nd}{1,2})$/u.exec(compact);
  const whole = (decimal ? compact.slice(0, decimal.index) : compact).replace(/[.,]/gu, "");
  const fraction = (decimal?.[1] ?? "").padEnd(2, "0");
  return Number(whole) * 100 + Number(fraction || "0");
}

function timeToken(hourText: string, minuteText: string, halfText: string | undefined) {
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const half = halfText ? (halfText.toLowerCase() === "a" ? "am" : "pm") : null;
  if (half || hour === 0 || hour > 12) {
    // A 24-hour time, or one with its half of the day, is a known instant.
    const hour24 = half ? (hour % 12) + (half === "pm" ? 12 : 0) : hour;
    return {
      kind: "time" as const,
      hour12: hour24 % 12 || 12,
      minute,
      half: hour24 < 12 ? ("am" as const) : ("pm" as const),
    };
  }
  return { kind: "time" as const, hour12: hour, minute, half: null };
}

/**
 * Each pattern reads one kind and blanks what it read, in this order, so a
 * later kind never sees a piece of an earlier one.
 */
const READERS: readonly {
  pattern: RegExp;
  /** The whole match first, then each group. */
  read: (match: readonly (string | undefined)[]) => NumberToken | null;
}[] = [
  {
    // Seven digits or more, spaced or dashed: a phone number.
    pattern: /\+?\p{Nd}[\p{Nd} () .-]{5,}\p{Nd}/gu,
    read: (match) => {
      const whole = match[0] ?? "";
      const digits = whole.replace(/\P{Nd}/gu, "");
      return digits.length >= 7 && !/[.]\p{Nd}{1,2}$/u.test(whole)
        ? { kind: "phone", digits }
        : null;
    },
  },
  {
    // A mark before the amount ("$95", "US$ 95") or after it ("95,00 €"); a
    // mark after is never one that starts the next amount ("2 $95").
    pattern: new RegExp(
      `${CURRENCY_MARK}${SP}?(${AMOUNT})|(${AMOUNT})${SP}?${CURRENCY_MARK}(?!${SP}?\\p{Nd})`,
      "giu",
    ),
    read: (match) => ({ kind: "price", cents: amountCents(match[1] ?? match[2] ?? "") }),
  },
  {
    pattern: new RegExp(`(\\p{Nd}{1,2})[:h](\\p{Nd}{2})(?!\\p{Nd})(?:${MERIDIEM})?`, "giu"),
    read: (match) => timeToken(match[1] ?? "", match[2] ?? "", match[3]),
  },
  {
    pattern: new RegExp(`(?<![\\p{Nd}.,])(\\p{Nd}{1,2})${MERIDIEM}`, "giu"),
    read: (match) => timeToken(match[1] ?? "", "0", match[2]),
  },
  {
    pattern: new RegExp(`(?<![\\p{Nd}.,])(\\p{Nd}{1,2})${SP}?h(?![\\p{L}])`, "giu"),
    read: (match) => ({ kind: "hour", hour: Number(match[1]) }),
  },
  {
    pattern: new RegExp(
      `(?<![\\p{L}])${MONTH}${SP}+(\\p{Nd}{1,2})(?![\\p{Nd}])|(?<![\\p{Nd}])(\\p{Nd}{1,2})\\.?${SP}+(?:de${SP}+)?${MONTH}(?![\\p{L}])`,
      "giu",
    ),
    read: (match) => {
      const month = monthNumber(match[1] ?? match[4] ?? "");
      const day = Number(match[2] ?? match[3]);
      return month ? { kind: "date", month, day } : null;
    },
  },
  {
    // "10/24": a date written in figures, read either way round.
    pattern: /(?<![\p{Nd}/])(\p{Nd}{1,2})\/(\p{Nd}{1,2})(?![\p{Nd}/])/gu,
    read: (match) => {
      const first = Number(match[1]);
      const second = Number(match[2]);
      return {
        kind: "day",
        days: [
          { month: first, day: second },
          { month: second, day: first },
        ],
      };
    },
  },
  {
    // i18n-exempt: ordinal endings the reader looks for, never shown
    pattern: /(?<![\p{Nd}])(\p{Nd}{1,2})(?:st|nd|rd|th|º|ª)(?![\p{L}])/giu,
    read: (match) => ({ kind: "day", days: [{ month: null, day: Number(match[1]) }] }),
  },
  {
    pattern: /\p{Nd}+(?:[.,]\p{Nd}+)?/gu,
    read: (match) => ({ kind: "count", value: (match[0] ?? "").replace(",", ".") }),
  },
];

/** Every number in a text, each as one token of its kind. */
function numberTokens(text: string): NumberToken[] {
  const tokens: NumberToken[] = [];
  let rest = text;
  for (const { pattern, read } of READERS) {
    rest = rest.replace(pattern, (whole: string, ...rest: unknown[]) => {
      // `replace` passes the groups, then the offset and the whole string.
      const token = read([whole, ...(rest.slice(0, -2) as (string | undefined)[])]);
      if (!token) return whole;
      tokens.push(token);
      return " ".repeat(whole.length);
    });
  }
  return tokens;
}

/** Whether `said` can be read as `given`. 2 means the same token; 1 a looser reading. */
function matchScore(said: NumberToken, given: NumberToken): 0 | 1 | 2 {
  switch (said.kind) {
    case "phone":
      return given.kind === "phone" && given.digits === said.digits ? 2 : 0;
    case "price":
      return given.kind === "price" && given.cents === said.cents ? 2 : 0;
    case "count":
      if (given.kind === "hour") return given.hour === Number(said.value) ? 1 : 0;
      return given.kind === "count" && Number(given.value) === Number(said.value) ? 2 : 0;
    case "hour":
      if (given.kind === "hour") return given.hour === said.hour ? 2 : 0;
      if (given.kind === "count") return Number(given.value) === said.hour ? 1 : 0;
      return given.kind === "time" && given.minute === 0 && given.hour12 === (said.hour % 12 || 12)
        ? 1
        : 0;
    case "time":
      if (given.kind === "hour") {
        return said.minute === 0 && said.hour12 === (given.hour % 12 || 12) ? 1 : 0;
      }
      if (given.kind !== "time" || given.hour12 !== said.hour12 || given.minute !== said.minute) {
        return 0;
      }
      if (said.half === given.half) return 2;
      return said.half === null || given.half === null ? 1 : 0;
    case "date":
      return given.kind === "date" && given.month === said.month && given.day === said.day ? 2 : 0;
    case "day":
      if (given.kind === "day") {
        return JSON.stringify(given.days) === JSON.stringify(said.days) ? 2 : 0;
      }
      return given.kind === "date" &&
        said.days.some(
          (option) =>
            option.day === given.day && (option.month === null || option.month === given.month),
        )
        ? 1
        : 0;
  }
}

/**
 * True when every number in `output` is a number of the same kind in
 * `source`, used no more often than `source` gives it: a summary or a
 * translation may drop a number, never add or change one. See
 * {@link NumberToken} for what counts as one number.
 */
export function numbersCameFrom(output: string, source: string): boolean {
  const offered = numberTokens(source);
  const used = new Set<number>();
  for (const said of numberTokens(output)) {
    let best = -1;
    let bestFit = 0;
    offered.forEach((given, index) => {
      if (used.has(index)) return;
      const score = matchScore(said, given);
      if (score > bestFit) {
        best = index;
        bestFit = score;
      }
    });
    if (best < 0) return false;
    used.add(best);
  }
  return true;
}

/** True when both texts carry the same placeholders (`{depth18}`), as multisets. */
export function samePlaceholders(a: string, b: string): boolean {
  const left = placeholdersIn(a).sort();
  const right = placeholdersIn(b).sort();
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

/** Trimmed, at most `max` characters, or null when nothing is left. */
export function boundedText(value: string | null | undefined, max: number): string | null {
  const text = value?.trim() ?? "";
  if (!text) return null;
  return text.length > max ? null : text;
}

/** The text with every placeholder blanked, for checking only what the model wrote. */
function bareText(text: string): string {
  return text.replace(PLACEHOLDER, " ");
}

/** A whole-word, case-blind search for any of `words`, in any script. */
function wordPattern(words: readonly string[]): RegExp {
  return new RegExp(`(^|[^\\p{L}])(${words.join("|")})($|[^\\p{L}])`, "iu");
}

/**
 * Count words the digit check would let through. A number comes from the
 * record by placeholder, so "three", "a dozen" or "tres" written by the model
 * is refused like a digit.
 */
const NUMBER_WORD = wordPattern([
  // i18n-exempt: words the refusal looks for, never shown
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fifteen|twenty|thirty|forty|fifty|hundreds?|dozens?|couple|pair|single",
  // i18n-exempt: words the refusal looks for, never shown
  "uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce|quince|veinte|treinta|cuarenta|cincuenta|cien|cientos|docenas?|par|pareja",
]);

/** Every count word in a text, lowercased, repeats included. */
function numberWordsIn(text: string): string[] {
  const words: string[] = [];
  const global = new RegExp(NUMBER_WORD.source, "giu");
  // `lastIndex` steps back over the trailing boundary, so two count words in
  // a row are both found.
  for (let match = global.exec(text); match; match = global.exec(text)) {
    words.push((match[2] ?? "").toLowerCase());
    global.lastIndex -= (match[3] ?? "").length;
  }
  return words;
}

/** What each count word is worth, so English and Spanish can be compared. */
const NUMBER_WORD_VALUES: Readonly<Record<string, number>> = {
  // i18n-exempt: words the comparison reads, never shown
  one: 1,
  single: 1,
  uno: 1,
  two: 2,
  couple: 2,
  pair: 2,
  dos: 2,
  par: 2,
  pareja: 2,
  three: 3,
  tres: 3,
  four: 4,
  cuatro: 4,
  five: 5,
  cinco: 5,
  six: 6,
  seis: 6,
  seven: 7,
  siete: 7,
  eight: 8,
  ocho: 8,
  nine: 9,
  nueve: 9,
  ten: 10,
  diez: 10,
  eleven: 11,
  twelve: 12,
  doce: 12,
  dozen: 12,
  dozens: 12,
  docena: 12,
  docenas: 12,
  thirteen: 13,
  fifteen: 15,
  quince: 15,
  twenty: 20,
  veinte: 20,
  thirty: 30,
  treinta: 30,
  forty: 40,
  cuarenta: 40,
  fifty: 50,
  cincuenta: 50,
  hundred: 100,
  hundreds: 100,
  cien: 100,
  cientos: 100,
};

/**
 * True when both texts write the same counts in words, compared by value
 * ("two" and "dos" agree; "two" and "tres" do not). One is left out: Spanish
 * says it with the article "un" or "una", which is not a count word here.
 */
export function sameNumberWords(a: string, b: string): boolean {
  const values = (text: string) =>
    numberWordsIn(bareText(text))
      .map((word) => NUMBER_WORD_VALUES[word] ?? -1)
      .filter((value) => value !== 1)
      .sort((x, y) => x - y);
  const left = values(a);
  const right = values(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * True when the text writes a count in words. With `given`, a word the given
 * text already says (a trip called "Two-tank reef") is quoting, not counting,
 * and passes as often as `given` says it.
 */
export function hasNumberWord(text: string, given = ""): boolean {
  const offered = new Map<string, number>();
  for (const word of numberWordsIn(given)) offered.set(word, (offered.get(word) ?? 0) + 1);
  for (const word of numberWordsIn(bareText(text))) {
    const left = offered.get(word) ?? 0;
    if (left === 0) return true;
    offered.set(word, left - 1);
  }
  return false;
}

/**
 * **Who a dive is for is the record's, never the prose's** (glossary
 * `certification.md`, Requirement; dive-domain review of the copywriter and
 * site brief). The page shows the requirement itself, so a draft that names a
 * level, a certification, an age or an audience is refused whole: prose would
 * be a second, weaker statement of a gate.
 */
const AUDIENCE_WORD = wordPattern([
  // i18n-exempt: words the refusal looks for, never shown
  "certif\\p{L}*|open water|advanced|rescue|divemasters?|instructors?|beginners?|novices?|first[- ]tim\\p{L}*|newly|experience|experienced|suits?|suited|ideal for|perfect for|great for|for everyone|for anyone|levels?|prerequisites?|ages?|years old",
  // i18n-exempt: words the refusal looks for, never shown
  "certific\\p{L}*|aguas abiertas|avanzad\\p{L}*|rescate|principiantes?|novat\\p{L}*|primera vez|experiencia|experimentad\\p{L}*|ideal para|perfect\\p{L}* para|para todos|para cualquiera|nivel\\p{L}*|requisitos?|edad\\p{L}*|años",
]);

/** Words that soften a dive. Allowed only when the site's own difficulty is `beginner`. */
const SOFT_WORD = wordPattern([
  // i18n-exempt: words the refusal looks for, never shown
  "easy|easier|gentle|mellow|relaxed|relaxing|mild|calm|lazy|f[aá]cil|suaves?|tranquil\\p{L}*|relajad\\p{L}*|calmad\\p{L}*",
]);

/** The text with each of the record's own words (a title, an agency) blanked, so naming them is not a claim. */
function withoutGiven(text: string, given: readonly string[]): string {
  let rest = bareText(text);
  for (const word of [...given].sort((a, b) => b.length - a.length)) {
    if (word.trim().length < 3) continue;
    rest = rest.split(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu")).join(" ");
  }
  return rest;
}

/** True when a draft says who the dive suits, or names a level, a card or an age. */
export function claimsAnAudience(text: string, given: readonly string[]): boolean {
  return AUDIENCE_WORD.test(withoutGiven(text, given));
}

/** True when a draft calls the dive easy or gentle in words the record did not give. */
export function softensTheDive(text: string, given: readonly string[]): boolean {
  return SOFT_WORD.test(withoutGiven(text, given));
}

/** The locale's language as the prompt names it. */
export function promptLanguage(locale: string): string {
  return locale.toLowerCase().startsWith("es")
    ? "Latin American Spanish"
    : "English (United States)";
}

/**
 * The brand voice every drafted sentence is held to, in one place so each
 * assist's instructions say it the same way (docs/design/brand.md, "What gives
 * us away").
 */
export const VOICE_RULES = [
  "Write like a competent divemaster briefing a crew: warm, plain, brief.",
  "No em dashes, no exclamation marks, no rhetorical questions, no intensifiers such as actually, genuinely, truly, incredibly.",
  "No 'not X, Y' contrasts, no lists of three for rhythm, no closing flourish.",
  "American spelling in English.",
].join(" ");
