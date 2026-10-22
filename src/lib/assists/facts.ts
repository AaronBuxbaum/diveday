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

/** The runs of digits in a text, sorted, for comparing two texts' numbers. */
export function digitRuns(text: string): string[] {
  return [...text.matchAll(/\p{Nd}+(?:[.,]\p{Nd}+)?/gu)].map((match) => match[0]).sort();
}

/**
 * True when every number in `output` appears in `source`: a summary or a
 * translation may drop a number, never add or change one.
 */
export function numbersCameFrom(output: string, source: string): boolean {
  const offered = new Map<string, number>();
  for (const run of digitRuns(source)) offered.set(run, (offered.get(run) ?? 0) + 1);
  for (const run of digitRuns(output)) {
    const left = offered.get(run) ?? 0;
    if (left === 0) return false;
    offered.set(run, left - 1);
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
