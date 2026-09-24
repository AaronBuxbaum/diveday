import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * The copy does not sound like a language model wrote it.
 *
 * Every word a shop or a diver reads comes through the message bundles under
 * `src/i18n/locales/`, and by 2026-09-03 those bundles carried the mannerisms
 * that give machine-written prose away: an em-dash pivot in most sentences
 * ("one answer — all day", "at the desk — not at the dock"), the "not a
 * project, a file" contrast, the "No X. No Y. No Z." run, "actually" and
 * "genuinely" and "plainly" doing the work a plain claim should do, and the
 * "Here's how" lead-in. None of them is wrong in isolation. Together they read
 * as a voice a reader has met a thousand times this year and learned to skim,
 * which on a marketing page is the one outcome the page exists to avoid.
 *
 * The rules a writer follows are in `docs/design/brand.md` ("What gives us
 * away"). This guard holds the mechanical subset — the shapes a regex can name
 * without lying — over every bundle value, per locale:
 *
 * - **A prose em-dash.** An em-dash between two clauses of three or more words,
 *   or anywhere in a string that carries a sentence terminator. A short label
 *   separator ("Boarded — tap again to undo", "Checked in — 2") is not a
 *   sentence and is left alone; the tell is the dash that replaced a full stop,
 *   a comma or a colon in running prose.
 * - **A filler intensifier.** "actually", "genuinely", "simply", "quietly",
 *   "seamless", "effortless", "elevate", "empower", "streamline", "leverage",
 *   "robust": words that assert a quality instead of showing it. ("Unlock" is
 *   not on the list: the water lock's "hold to unlock" is a literal verb.)
 * - **A lead-in.** "Here's how", "the best part", "rest assured", "say goodbye
 *   to", "whether you're", "at its core", "it's worth noting".
 * - **The "not just" contrast.** "isn't just", "more than just", "not about
 *   X, it's about Y".
 * - **The staccato run.** Two consecutive sentences of a few words each that
 *   both begin "No" — "No setup fee. No per-seat math."
 * - **A straight apostrophe.** The house apostrophe is `’` (U+2019), never `'`
 *   (U+0027) — a typography rule that earns its place here because Playwright
 *   matches the two as different strings and every e2e spec hard-codes its
 *   English (issue #1367). The one exception is an ICU-quoted span
 *   (`'{depth18}'`), which must stay straight or the marker stops being a
 *   literal.
 *
 * - **Four shapes**, on the public pages' strings only (2026-09-24): the
 *   mirrored pair, the anaphoric triplet, the tag sentence, and the house
 *   phrase repeated across pages. Each is defined, with what it leaves alone,
 *   above `shapeTells` below.
 *
 * Every locale states its own word list, and a locale with none is a failure
 * rather than a pass: a third language must name what it refuses.
 *
 * **Two places, one rule set** (issue #1317). The bundles are most of the
 * words, but not all of them: a route's `metadata` block is English literals
 * by design — one canonical URL, one `<head>`, no locale in the path (ADR
 * 20260812-reader-chosen-language) — and those literals are a search snippet
 * and a link-preview card, which is where a reader meets the voice before
 * they meet the page. They were swept by hand on 2026-09-03 and nothing
 * stopped the next edit putting an em-dash pivot back.
 *
 * `docs/` is deliberately **not** scanned. An em-dash in a runbook is ordinary
 * typesetting, `check:docs` has a different job, and pointing this at prose
 * written for a reader who is not a customer would train people to add
 * exemptions. The pilot-kit collateral is read by a human against
 * `docs/design/brand.md` instead.
 *
 * Ratcheted like `check:copy` — a per-file count in `scripts/voice-baseline.json`
 * that may only fall. `--write` banks a fall and refuses a rise, `--absorb`
 * records growth that arrived in a merge, `--report [prefix]` prints every hit.
 * It lands at zero, so it behaves as a full gate today.
 */

const ROOT = process.cwd();
const BASELINE_PATH = "scripts/voice-baseline.json";
export const LOCALES_DIR = "src/i18n/locales";

/**
 * A spaced em-dash (or a double hyphen standing in for one). The en-dash is
 * left alone: it is a range ("8:05 – 8:47"), never a pivot.
 */
const DASH_PATTERN = /\s(?:—|--)\s/g;

/** How many words on each side of a dash before it reads as two clauses. */
const CLAUSE_WORDS = 3;

/**
 * A span ICU MessageFormat treats as quoted, and the only place a straight
 * apostrophe survives this guard.
 *
 * In DOUBLE_OPTIONAL mode a `'` opens a literal section only when the next
 * character is `{`, `}` or `#` — which is what lets
 * `courses.edit.errorDepthPlaceholder` show a shop the literal `'{depth18}'`
 * marker to type, and what escapes WhatsApp's `'{{1}}'` placeholders past ICU.
 * Deliberately *not* a blanket `'[^']*'`: that would also swallow everything
 * between two prose apostrophes, so `"You're on {shopName}'s list"` would go
 * unmeasured. Same shape, same reasoning, as `namesAnArgument` in
 * `src/i18n/raw-messages.test.ts`.
 */
const ICU_QUOTED = /'[{}#][^']*'/g;

/**
 * Per-locale word rules. Each is a regex over the whole value; a locale that
 * appears in `src/i18n/locales/` and not here fails the check.
 *
 * Every contraction is written `['’]`, because the bundles now spell the
 * apostrophe `’` and a pattern that named only `'` would have stopped matching
 * anything the day the sweep landed (issue #1367) — the rule would still be
 * listed, still be tested against its own straight-apostrophe fixtures, and
 * never fire on a real string again.
 */
export const RULES = {
  "en-US": {
    filler:
      /\b(?:actually|genuinely|simply|quietly|truly|literally|seamless(?:ly)?|effortless(?:ly)?|elevates?d?|empower(?:s|ed|ing)?|streamlines?d?|leverages?d?|robust|delve|supercharge[sd]?|frictionless|hassle-free|world-class|cutting-edge|best-in-class|next-level|game-changer|revolutioni[sz]e\w*|transformative)\b/gi,
    leadIn:
      /\b(?:here['’]s (?:how|what|the|why|where)|here is (?:how|what|why)|the best part|let['’]s be honest|rest assured|look no further|say goodbye to|whether you['’]re|in today['’]s (?:world|market|landscape|economy|fast-paced)|at its core|it['’]s worth noting|the whole point|the thing is)\b/gi,
    notJust:
      /\b(?:isn['’]t just|is not just|aren['’]t just|not just\b|more than just|isn['’]t about|is not about|it['’]s not (?:a|an|about) [^.]{0,40}, it['’]s)\b/gi,
    staccato: /\b(?:No|Nothing|Never) [^.!?]{1,24}[.!?] (?:No|Nothing|Never)\b/g,
  },
  "es-ES": {
    filler:
      /\b(?:realmente|genuinamente|simplemente|sin esfuerzo|sin fricciones|potenciar|revolucionar?)\b/gi,
    leadIn: /\b(?:la mejor parte|di adiós a|hoy en día|en esencia|vale la pena señalar)\b/gi,
    notJust: /\b(?:no es solo|no se trata (?:solo )?de|más que (?:un|una) simple)\b/gi,
    staccato: /\b(?:Sin|Ni|Nada) [^.!?]{1,24}[.!?] (?:Sin|Ni|Nada)\b/g,
  },
};

/**
 * A dash is a tell when it sits inside running prose: a sentence terminator
 * anywhere in the value, or three or more words on each side of it.
 */
export function proseDashes(value) {
  const found = [];
  const hasSentence = /[.!?]/.test(value);
  DASH_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(DASH_PATTERN)) {
    const left = value.slice(0, match.index).trim().split(/\s+/).filter(Boolean);
    const right = value
      .slice(match.index + match[0].length)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (hasSentence || (left.length >= CLAUSE_WORDS && right.length >= CLAUSE_WORDS)) {
      const excerpt = `${left.slice(-3).join(" ")} — ${right.slice(0, 3).join(" ")}`;
      found.push({ rule: "em-dash", text: excerpt });
    }
  }
  return found;
}

/**
 * A straight apostrophe in prose a person reads.
 *
 * The house apostrophe is `’` (U+2019). Both spellings landed for as long as
 * the bundles existed, and the mismatch is invisible on screen — it renders
 * fine either way and no reader notices. It is not invisible to Playwright:
 * `getByRole(name)` and `getByText` match the two characters as different
 * strings, and every e2e spec here hard-codes the English a user sees. On
 * PR #1365 (`24f18a2`) a bundle string with `'` and two specs asserting `’`
 * cost a full CI round, and the fix was one character (issue #1367).
 *
 * Beside `proseDashes` rather than inside `RULES` on purpose: this is
 * typography, not a per-language word list, so a third locale inherits it
 * without naming it. A `RULES` entry would silently not apply.
 */
export function straightApostrophes(value) {
  const found = [];
  const prose = value.replace(ICU_QUOTED, (span) => " ".repeat(span.length));
  for (let index = prose.indexOf("'"); index !== -1; index = prose.indexOf("'", index + 1)) {
    // The apostrophe's own word plus one either side, so `--report` output is
    // greppable back to the string it came from.
    const before = prose.slice(0, index).split(/\s+/).filter(Boolean).slice(-2);
    const after = prose
      .slice(index + 1)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    const excerpt = `${before.join(" ")}'${after.join(" ")}`.trim();
    found.push({ rule: "apostrophe", text: excerpt });
  }
  return found;
}

/**
 * A straight double quote in prose a person reads.
 *
 * The house quotation marks are `“ ”`, and the bundles were already mostly
 * spelling them that way: 238 curly against 54 straight when this was swept
 * (issue #1664). The collision is the apostrophe's, at a fifth of the volume
 * — both spellings render fine and no reader notices, and Playwright matches
 * them as different strings while every e2e spec here hard-codes its English.
 * `marketing.guides.fareharbor.coexist.intro` and `…eve.coexist.intro` made the
 * same rhetorical move one scroll apart, in two different characters.
 *
 * **No ICU exemption, unlike the apostrophe above.** A straight `'` is what
 * makes an ICU span a literal, so `'{depth18}'` has to keep it; `"` carries no
 * meaning in ICU at all, so there is no span where the straight character is
 * required and nothing to strip before scanning. It landed at zero with no
 * exemption list.
 *
 * Spanish sweeps the same way: `es-ES/README.md` settles it as `“ ”` rather
 * than the peninsular `« »`, so this sits beside `proseDashes` rather than
 * inside `RULES` — typography a third locale inherits without naming it.
 */
export function straightDoubleQuotes(value) {
  const found = [];
  for (let index = value.indexOf('"'); index !== -1; index = value.indexOf('"', index + 1)) {
    // The quote's own word plus one either side, the same shape the apostrophe
    // rule reports in, so `--report` output greps back to its string.
    const before = value.slice(0, index).split(/\s+/).filter(Boolean).slice(-2);
    const after = value
      .slice(index + 1)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    found.push({ rule: "quote", text: `${before.join(" ")}"${after.join(" ")}`.trim() });
  }
  return found;
}

/**
 * The four **shape** rules (2026-09-24, the voice decision — H-89 in
 * docs/product/human-decisions.md, "The builder's note" in docs/design/brand.md).
 *
 * The 2026-09-03 sweep removed the words a model overuses and left the shapes:
 * measured over the five marketing pages afterwards, the mirrored pair
 * ("come in with a file and leave with a button"), the list of three with a
 * tail ("never crashes, never logs you out, and never needs five taps"), the
 * tag sentence (36 sentences of five words or fewer, most of them a beat after
 * a long one: "One answer, all day."), and the house phrase reused across
 * pages ("from day one" seven times, "a real person" four). Each is a regex's
 * job once it is named precisely, and each is named here as narrowly as it
 * can be so the "leaves alone" cases in the test file hold:
 *
 * - **The mirrored pair.** Two clauses of one sentence, each three or more
 *   words, joined by a conjunction, that open with the same two words or close
 *   on the same two words before the last ("nothing gets asked twice and
 *   nothing gets missed once"; "come in with a file and leave with a button").
 *   A factual pair with different words on both ends ("no setup fee and no
 *   annual contract") is a fact, not a mirror.
 * - **The anaphoric triplet.** A comma list whose second and third items open
 *   with the same word and whose first item carries it too ("paper never
 *   crashes, never logs you out, and never needs five taps"). Articles and the
 *   ledger's "no" are exempt: "a whiteboard, a clipboard, a spreadsheet" and
 *   "no setup fee, no contract, no card" are lists of things, and a list has
 *   however many items are true.
 * - **The tag sentence.** A value's last sentence of four words or fewer, with
 *   no number, placeholder or arrow in it, after a sentence of seven or more.
 *   A beat for effect, in the one position where it can only be effect. A
 *   short sentence elsewhere in the value is speech and is left alone.
 * - **The house phrase.** Three consecutive words, two of them content words,
 *   appearing on more than two distinct pages of a bundle. The names of things
 *   ("the live demo", "your own Stripe account") are exempt by list; a phrase
 *   of style is not, whatever it is.
 *
 * The three per-value shapes apply to the public pages' strings only
 * (`SHAPE_SCOPES`): a product screen's label is four words by design, and its
 * notices are the register docs/design/brand.md calls the divemaster's, where
 * a short sentence is the norm rather than a beat. The house-phrase rule is
 * per file and only ever compares those same namespaces.
 */
export const SHAPE_SCOPES = ["marketing.", "switching.", "account.onboard.", "metadata."];

export function inShapeScope(key) {
  // A notice ("Your shop was created, but signing you in failed. Try signing
  // in below.") is the divemaster's register, where the short last sentence
  // is the next action rather than a beat.
  if (/\.errors?\./.test(key)) return false;
  return SHAPE_SCOPES.some((prefix) => key.startsWith(prefix));
}

const CONJUNCTION_WORDS = new Set(["and", "but", "or", "nor", "y", "e", "o", "u", "pero", "ni"]);
const CONJUNCTIONS = /\s+(?:and|but|or|nor|y|e|o|u|pero|ni)\s+/i;
const SENTENCE_END = /(?<=[.!?…])\s+/;

/** Lower-case words with punctuation stripped, placeholders and tags removed. */
function wordsOf(text) {
  return text
    .toLowerCase()
    .replace(/\{[^}]*\}/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[^\p{L}\p{N}\s'’-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Words a list may open every item with, and a pair may open both halves
 * with: the articles, the possessives, the count "one", the infinitive's
 * "to", and the ledger's "no"/"ni"/"sin". "a whiteboard, a clipboard, a
 * spreadsheet", "your colour, your typeface, your cover photo", "one roster,
 * one waiver, one crew" and "no setup fee, no contract, no card" are lists of
 * things, and a list has however many items are true.
 */
const DETERMINERS = new Set(
  "a an the your our their its my one to no un una unos unas el la los las tu tus su sus mi mis nuestro nuestra nuestros nuestras ni sin".split(
    " ",
  ),
);

function sentencesOf(value) {
  return value
    .split(SENTENCE_END)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function mirroredPairs(value) {
  const found = [];
  for (const sentence of sentencesOf(value)) {
    const clauses = sentence.split(CONJUNCTIONS).map(wordsOf);
    for (let index = 1; index < clauses.length; index += 1) {
      const a = clauses[index - 1];
      const b = clauses[index];
      if (a.length < 3 || b.length < 3) continue;
      const sameOpening = !DETERMINERS.has(a[0]) && a[0] === b[0] && a[1] === b[1];
      const sameClosing =
        a[a.length - 2] === b[b.length - 2] && a[a.length - 3] === b[b.length - 3];
      if (sameOpening || sameClosing) {
        found.push({
          rule: "mirrored-pair",
          text: `${a.slice(0, 4).join(" ")}… / ${b.slice(0, 4).join(" ")}…`,
        });
      }
    }
  }
  return found;
}

export function anaphoricTriplets(value) {
  const found = [];
  for (const sentence of sentencesOf(value)) {
    const items = sentence
      .split(/,\s*/)
      .map((item) => item.replace(/^(?:and|or|y|e|o|u)\s+/i, ""))
      .map(wordsOf)
      .filter((item) => item.length > 0);
    for (let index = 2; index < items.length; index += 1) {
      const word = items[index][0];
      if (DETERMINERS.has(word) || word !== items[index - 1][0]) continue;
      if (!items[index - 2].includes(word)) continue;
      found.push({ rule: "anaphoric-triplet", text: `${word} …, ${word} …, ${word} …` });
      break;
    }
  }
  return found;
}

const TAG_MAX_WORDS = 4;
const TAG_AFTER_WORDS = 7;

export function tagSentences(value) {
  const sentences = sentencesOf(value);
  if (sentences.length < 2) return [];
  const last = sentences[sentences.length - 1];
  const previous = sentences[sentences.length - 2];
  if (/[\d{}→<>@]/.test(last) || !/[.!?…]$/.test(last)) return [];
  const lastWords = wordsOf(last);
  if (lastWords.length === 0 || lastWords.length > TAG_MAX_WORDS) return [];
  if (wordsOf(previous).length < TAG_AFTER_WORDS) return [];
  return [{ rule: "tag-sentence", text: last }];
}

/** Every per-value shape, for a key in scope. */
export function shapeTells(value) {
  return [...mirroredPairs(value), ...anaphoricTriplets(value), ...tagSentences(value)];
}

/**
 * Which public page a bundle key belongs to, or `null` for a namespace that is
 * rendered on several pages by design (the shared feature groups, the price
 * list, the export claim, the switching chrome and the guides' shared phases)
 * or for a product-screen key, which the rule never compares.
 *
 * The five competitor guides are one page here: they mirror each other's
 * structure on purpose, so a sentence all five carry is a template, not a tic.
 */
const SHARED_NAMESPACES = [
  "marketing.common.",
  "marketing.features.",
  "marketing.price.",
  "marketing.export.",
  "marketing.capabilities.",
  "marketing.guides.shared.",
  "switching.common.",
  "switching.concierge.",
];

export function pageOf(key) {
  if (SHARED_NAMESPACES.some((prefix) => key.startsWith(prefix))) return null;
  if (key.startsWith("marketing.guides.")) return "guides";
  const [head, page] = key.split(".");
  if (head === "marketing" || head === "switching") return `${head}.${page}`;
  if (key.startsWith("account.onboard.")) return "onboard";
  return null;
}

/**
 * Function words, per locale. "one" and "two" are deliberately not here: a
 * number word carries meaning ("from day one", "one ZIP", "one button"), and
 * "one ZIP / button / number / price" sixteen times across five pages was the
 * house phrase this rule was written for.
 */
const STOPWORDS = {
  "en-US": new Set(
    "a an the and or but of to in on at for with from by is are was were be been it its your you we our us they their them this that these those as not no if so do does did than then into out up off all any every each can will what who when where which there here have has had my me he she him her his own same about over before after until while whether only more most other some such like once just also very".split(
      " ",
    ),
  ),
  "es-ES": new Set(
    "un una unos unas el la los las y e o u de del en con por para es son se su sus tu tus que lo al a no ni sin como más cada todo toda todos todas hay ya si este esta esto ese esa eso le les me te nos mi mis nuestro nuestra nuestros nuestras uno otra otro otras otros aquí allí entre sobre desde hasta cuando donde quién qué cuál cuáles pero también muy solo sólo está están ser era fue han ha he hemos cualquier cualquiera propio propia propios propias mismo misma mismos mismas primer primera primero tras ante según además aunque porque así tan tanto algo nada nadie ningún ninguna ninguno mucho mucha muchos muchas poco poca pocos pocas".split(
      " ",
    ),
  ),
};

/**
 * Names of things, which several pages may call by the same three words. A
 * phrase joins this list because it is what the thing is called, never
 * because it reads well.
 */
export const HOUSE_PHRASE_ALLOWLIST = new Set([
  "the live demo",
  "try the live demo",
  "the sample shop",
  "a real person",
  "real person reads",
  "person reads it",
  "your own stripe",
  "own stripe account",
  "the pricing page",
  "a dive shop",
  "the dive day",
  "roll call",
  "run roll call",
  "certification records",
  "the export button",
  "the head count",
  "a head count",
  "with no signal",
  "the night before",
  "the first day",
  "first day of",
  "of a trial",
  "start a trial",
  "the boat leaves",
  "before the boat",
  "the demo is",
  "demo is the",
  "is the sample",
  "switching to diveday",
  "one row per",
  "no setup fee",
  "the full list",
  "hoja de cálculo",
  "registros de certificación",
  "día de buceo",
  "contacto de emergencia",
  "tallas de alquiler",
  "historial de pagos",
  "centros de buceo",
  "centro de buceo",
  "base de datos",
  "cuota de alta",
  "de venta minorista",
  "como propietario capitán",
  "un precio único",
  "precio único de",
  "antes de guardar",
  "ajustes cualquier día",
  "el centro de",
  "de buceo",
  "la demo",
  "la demo en",
  "demo en vivo",
  "una persona real",
  "persona real lo",
  "real lo lee",
  "tu propia cuenta",
  "propia cuenta de",
  "cuenta de stripe",
  "la página de",
  "página de precios",
  "pase de lista",
  "el pase de",
  "primer día de",
  "día de la",
  "de la prueba",
  "sin señal",
  "la noche anterior",
  "nombre del centro",
  "centro de muestra",
  "la vista previa",
  "inicio de sesión",
  "exportación de datos",
  "lee una persona",
  "la lista completa",
  "comisión por reserva",
  "teléfono sin señal",
]);

/**
 * Phrases repeated across pages of one bundle. Returns one hit per phrase,
 * naming the pages it appears on.
 */
export function housePhrases(entries, locale) {
  const stopwords = STOPWORDS[locale];
  if (!stopwords) throw new Error(`no stopword list for locale ${locale}`);
  const pagesByPhrase = new Map();
  for (const { key, value } of entries) {
    const page = pageOf(key);
    if (!page) continue;
    // A conjunction ends a phrase: "rental sizes and certification records"
    // is two names, not one three-word phrase.
    const words = wordsOf(value).map((word) => (CONJUNCTION_WORDS.has(word) ? null : word));
    for (let index = 0; index + 3 <= words.length; index += 1) {
      const gram = words.slice(index, index + 3);
      if (gram.some((word) => word === null || /\d/.test(word))) continue;
      if (gram.filter((word) => !stopwords.has(word)).length < 2) continue;
      const phrase = gram.join(" ");
      if (HOUSE_PHRASE_ALLOWLIST.has(phrase)) continue;
      if (!pagesByPhrase.has(phrase)) pagesByPhrase.set(phrase, new Set());
      pagesByPhrase.get(phrase).add(page);
    }
  }
  const found = [];
  for (const [phrase, pages] of pagesByPhrase) {
    if (pages.size <= 2) continue;
    found.push({ key: `“${phrase}”`, rule: "house-phrase", text: [...pages].sort().join(", ") });
  }
  return found;
}

/**
 * Every tell in one bundle value, for one locale. The shape rules apply only
 * to a key under `SHAPE_SCOPES`; a call with no key measures words and
 * typography alone.
 */
export function findTells(value, locale, key = "") {
  const rules = RULES[locale];
  if (!rules) throw new Error(`no voice rules for locale ${locale}`);
  const found = [
    ...proseDashes(value),
    ...straightApostrophes(value),
    ...straightDoubleQuotes(value),
    ...(inShapeScope(key) ? shapeTells(value) : []),
  ];
  for (const [rule, pattern] of Object.entries(rules)) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) found.push({ rule, text: match[0] });
  }
  return found;
}

function walkValues(node, prefix, visit) {
  if (typeof node === "string") {
    visit(prefix, node);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, child] of Object.entries(node)) {
      walkValues(child, prefix ? `${prefix}.${key}` : key, visit);
    }
  }
}

/** Where a route's own English literals live. */
export const APP_DIR = "src/app";

/**
 * The block a route's metadata literals sit in, found by matching braces from
 * the declaration rather than by a regex over the whole file.
 *
 * A regex cannot tell `description:` inside `metadata` from one inside a
 * `<Chart description={…}>` prop or a zod schema forty lines below, and this
 * check reports per file — so a false positive there would be a hit nobody can
 * remove without an exemption. Brace matching is the cheap way to be sure the
 * string was in the block.
 */
function metadataBlocks(source) {
  const blocks = [];
  const declaration = /export\s+(?:const\s+metadata\b|(?:async\s+)?function\s+generateMetadata\b)/g;
  for (const match of source.matchAll(declaration)) {
    let index = source.indexOf("{", match.index);
    if (index === -1) continue;
    let depth = 0;
    const start = index;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push(source.slice(start, index + 1));
  }
  return blocks;
}

/**
 * `title:` and `description:` string literals inside a metadata block.
 *
 * Only *static* strings. A template literal carrying `${…}` is built from a
 * shop's own row or a translator call — `${shop.name} — DiveDay` is a shop's
 * name beside a label, not DiveDay's prose, and the translated half is already
 * covered where it lives, in the bundle. Escapes are unescaped so a value
 * written with `\'` measures the same as one written with `'`.
 */
export function metadataStrings(source) {
  const found = [];
  const literal =
    /\b(title|description)\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`$]*)`)/g;
  for (const block of metadataBlocks(source)) {
    for (const match of block.matchAll(literal)) {
      const raw = match[2] ?? match[3] ?? match[4];
      if (raw === undefined) continue;
      const value = raw.replace(/\\(.)/g, "$1");
      if (value.trim() === "") continue;
      found.push({ key: `metadata.${match[1]}`, value });
    }
  }
  return found;
}

/** Every `page.tsx`/`layout.tsx` under `src/app`, deepest last. */
async function routeFiles(relativeDirectory) {
  let entries;
  try {
    entries = await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await routeFiles(relativePath)));
    else if (entry.name === "page.tsx" || entry.name === "layout.tsx") files.push(relativePath);
  }
  return files.sort();
}

/**
 * Voice tells in route metadata, counted per route file.
 *
 * `en-US` rules throughout, because these literals have no locale: there is no
 * `[locale]` route and the `<head>` is written once.
 */
export async function scanMetadata() {
  const counts = new Map();
  const details = new Map();
  for (const file of await routeFiles(APP_DIR)) {
    const source = await readFile(path.join(ROOT, file), "utf8");
    const hits = [];
    for (const { key, value } of metadataStrings(source)) {
      for (const tell of findTells(value, "en-US", key)) hits.push({ key, ...tell });
    }
    if (hits.length > 0) {
      counts.set(file, hits.length);
      details.set(file, hits);
    }
  }
  return { counts, details };
}

async function bundleFiles(relativeDirectory) {
  let entries;
  try {
    entries = await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await bundleFiles(relativePath)));
    else if (entry.name.endsWith(".json")) files.push(relativePath);
  }
  return files.sort();
}

export async function scanBundles() {
  const counts = new Map();
  const details = new Map();
  const locales = (await readdir(path.join(ROOT, LOCALES_DIR), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const locale of locales) {
    if (!RULES[locale]) {
      throw new Error(
        `${LOCALES_DIR}/${locale} has no voice rules — add a word list for it in scripts/check-voice.mjs`,
      );
    }
    for (const file of await bundleFiles(path.join(LOCALES_DIR, locale))) {
      const bundle = JSON.parse(await readFile(path.join(ROOT, file), "utf8"));
      const hits = [];
      const entries = [];
      walkValues(bundle, "", (key, value) => {
        entries.push({ key, value });
        for (const tell of findTells(value, locale, key)) hits.push({ key, ...tell });
      });
      hits.push(...housePhrases(entries, locale));
      if (hits.length > 0) {
        counts.set(file, hits.length);
        details.set(file, hits);
      }
    }
  }
  return { counts, details };
}

async function main() {
  const bundles = await scanBundles();
  const metadata = await scanMetadata();
  // One map, so the baseline, the ratchet and the report treat a route file
  // exactly as they treat a bundle. Neither scan can produce the other's
  // paths, so nothing collides.
  const counts = new Map([...bundles.counts, ...metadata.counts]);
  const details = new Map([...bundles.details, ...metadata.details]);

  const reportIndex = process.argv.indexOf("--report");
  if (reportIndex !== -1) {
    const prefix = process.argv[reportIndex + 1] ?? "";
    let shown = 0;
    for (const [file, hits] of [...details.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (!file.startsWith(prefix)) continue;
      console.log(`\n${file} (${hits.length})`);
      for (const hit of hits) console.log(`  ${hit.key}\t${hit.rule}\t${hit.text}`);
      shown += hits.length;
    }
    console.log(`\n${shown} voice tells under "${prefix || `${LOCALES_DIR} and ${APP_DIR}`}"`);
    process.exit(0);
  }

  let baseline = {};
  let baselineExists = true;
  try {
    baseline = JSON.parse(await readFile(path.join(ROOT, BASELINE_PATH), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    baselineExists = false;
  }
  const baselineCounts = Object.fromEntries(
    Object.entries(baseline).filter(([key]) => !key.startsWith("//")),
  );

  const absorbing = process.argv.includes("--absorb");
  if (process.argv.includes("--write") || absorbing) {
    const grew = [...counts.entries()].filter(
      ([file, count]) => baselineExists && count > (baselineCounts[file] ?? 0),
    );
    const added = [...counts.keys()].filter((file) => baselineExists && !(file in baselineCounts));
    if (grew.length > 0 || added.length > 0) {
      if (!absorbing) {
        console.error(
          'Refusing to write a baseline that grows. Rewrite the sentence instead — docs/design/brand.md, "What gives us away":',
        );
        for (const [file, count] of grew) {
          console.error(`- ${file}: ${baselineCounts[file]} → ${count}`);
        }
        for (const file of added) console.error(`- ${file}: new file with ${counts.get(file)}`);
        console.error(
          "If this growth arrived in a merge from a branch that predates the sweep, `--absorb` records it explicitly.",
        );
        process.exit(1);
      }
      console.warn("Absorbing voice tells that grew — this must be merged-in work, not new:");
      for (const [file, count] of grew) {
        console.warn(
          `- ${file}: ${baselineCounts[file]} → ${count} (+${count - baselineCounts[file]})`,
        );
      }
      for (const file of added) console.warn(`- ${file}: new file with ${counts.get(file)}`);
    }
    const next = {
      "//": "Voice tells — a machine-written mannerism, or a straight apostrophe or double quote where the house ’ and “ ” belong — still in a message bundle or a route's metadata block, per file. Written by `node scripts/check-voice.mjs --write`. This number may only go down — see scripts/check-voice.mjs.",
      ...Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    };
    await writeFile(path.join(ROOT, BASELINE_PATH), `${JSON.stringify(next, null, 2)}\n`);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    console.log(`voice: baseline written — ${counts.size} files, ${total} tells left`);
    process.exit(0);
  }

  const violations = [];
  for (const [file, count] of counts) {
    const allowed = baselineCounts[file];
    if (allowed === undefined) {
      const sample = details
        .get(file)
        .slice(0, 5)
        .map((hit) => `\n    ${hit.key}  [${hit.rule}]  ${hit.text}`)
        .join("");
      violations.push(
        `${file}: ${count} voice tell${count === 1 ? "" : "s"} in a file with no baseline entry.${sample}`,
      );
      continue;
    }
    if (count > allowed) {
      const sample = details
        .get(file)
        .slice(0, 5)
        .map((hit) => `\n    ${hit.key}  [${hit.rule}]  ${hit.text}`)
        .join("");
      violations.push(
        `${file}: ${count} voice tells, baseline allows ${allowed}. Rewrite the sentence rather than raising the number.${sample}`,
      );
    }
    if (count < allowed) {
      violations.push(
        `${file}: down to ${count} from ${allowed}. Lower the baseline in this change (\`node scripts/check-voice.mjs --write\`).`,
      );
    }
  }
  for (const file of Object.keys(baselineCounts)) {
    if (!counts.has(file)) {
      violations.push(
        `${file}: fully swept or gone. Remove its baseline entry (\`node scripts/check-voice.mjs --write\`).`,
      );
    }
  }

  if (violations.length > 0) {
    console.error(`Voice violations:\n${violations.map((v) => `- ${v}`).join("\n")}`);
    console.error(
      "A prose em-dash becomes a full stop, a comma or a colon; an intensifier is deleted; a lead-in is deleted; a 'not just X' contrast states the thing; an apostrophe is ’ (U+2019), never ' — the ICU-quoted `'{depth18}'` markers are the only exception; quotation marks are “ ”, never \", with no exception, since \" means nothing to ICU. A mirrored pair keeps one of its halves; an anaphoric triplet becomes a list of however many things are true; a tag sentence joins the sentence before it or goes; a house phrase on three pages is reworded on two of them, or joins HOUSE_PHRASE_ALLOWLIST only when it is the name of a thing. The full list and the reasoning: docs/design/brand.md, \"What gives us away\". `node scripts/check-voice.mjs --report <file>` lists every hit.",
    );
    process.exit(1);
  }

  const remaining = [...counts.values()].reduce((sum, n) => sum + n, 0);
  console.log(
    `voice: ${remaining} tell${remaining === 1 ? "" : "s"} across ${counts.size} file${counts.size === 1 ? "" : "s"} (message bundles and route metadata)`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
