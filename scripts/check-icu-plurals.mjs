import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * **A number interpolated next to a noun has to inflect the noun.**
 *
 * `{blocked} bloqueados` renders "1 bloqueados" on the shop home the first time
 * a single diver is blocked, and the same message renders "1 seats open" in
 * English. Nothing fails: `pnpm check:locale` proves every key exists in every
 * locale, not that a count agrees with the word beside it, and the seeded demo
 * shop produces counts above one for almost everything — so a reviewer looking
 * at the demo sees correct Spanish and correct English (issue #778).
 *
 * Spanish makes it worse than English does, because it inflects the adjective
 * as well as the noun: the departure card's summary line carries four counts,
 * and a boat with one diver aboard got three ungrammatical fragments at once.
 *
 * The rule is therefore: **a count placeholder immediately followed by a word
 * the language inflects for number must sit inside an ICU `plural`.** ICU
 * handles the whole family — `one`/`other` here, and the `few`/`many` a Slavic
 * or Arabic locale would need if one is ever added — which is the reason to
 * reach for it rather than a ternary at the call site.
 *
 * ## What counts as a count
 *
 * Not every `{placeholder}` holds a number, and the false positives are the
 * interesting part: `{shopName} sails tomorrow` and `{competitor} publishes no
 * rate` both put a plural-looking verb after a placeholder, and
 * `preséntate en el muelle {dock} antes` interpolates a *pre-formatted duration
 * string* ("30 minutos") that has already been pluralised by whoever built it.
 *
 * So the placeholder name has to look like a count. `COUNT_NAMES` is that list,
 * kept explicit rather than inferred: a name not on it is not checked, which
 * makes a new counting placeholder something you add here deliberately. The
 * cost of the list being short is a miss; the cost of guessing from the call
 * site is a check nobody trusts.
 */

const ROOT = process.cwd();
const LOCALES_DIR = "src/i18n/locales";

/**
 * Placeholder names that hold a bare number.
 *
 * Deliberately not "any placeholder": `{dock}`, `{balance}` and `{price}` are
 * pre-formatted strings that already carry their own units, and `{shopName}`
 * and `{competitor}` are proper nouns whose following verb is not a plural at
 * all. A name here is a claim that the value reaching it is an integer the
 * reader will see rendered as digits.
 */
const COUNT_NAMES = new Set([
  "added",
  "ahead",
  "answered",
  "aboard",
  "blocked",
  "boarded",
  "booked",
  "capacity",
  "cards",
  "checkedIn",
  "complete",
  "completed",
  "count",
  "days",
  "dives",
  "divers",
  "done",
  "due",
  "hours",
  "limit",
  "lookback",
  "max",
  "min",
  "minutes",
  "open",
  "past",
  "future",
  "ready",
  "recorded",
  "requests",
  "since",
  "total",
  "updated",
  "value",
  "weeks",
]);

/**
 * A count placeholder, then a word that inflects for number.
 *
 * The optional `de {x}` / `of {x}` in the middle is the "3 of 8 divers
 * recorded" shape, where the noun agrees with the *second* number — English
 * and Spanish both do this, and it is the single most common form in these
 * bundles.
 *
 * Three letters minimum on the trailing word, so unit abbreviations (`m`,
 * `ft`, `kg`) and the `{booked}/{capacity} seats` slash form's own operands
 * are not read as nouns. A word ending in `s` is the plural test for both
 * languages here; `es-ES` also inflects adjectives, which end in `s` the same
 * way ("bloqueados", "listos", "reservadas").
 */
const COUNT_THEN_PLURAL =
  /\{([a-zA-Z]+)\}\s*(?:\/\s*\{[a-zA-Z]+\}\s*)?(?:(?:de|of)\s+\{([a-zA-Z]+)\}\s+)?(\p{L}{3,}[sS])\b/gu;

/**
 * `file:key.path` -> why this count can never be one.
 *
 * **"Unlikely" is not a reason; "unreachable" is.** The bar is that you can
 * name the branch or the constant that rules a count of one out, and the
 * entries below each do. Everything else got an ICU plural, including the ones
 * that merely *looked* safe: `Last {days} days` reads from a constant today,
 * and a constant is one product decision away from being 1.
 *
 * The sweep that filled this list found the bar working in both directions.
 * `{max} photos` looked like a fixed cap and turned out to be
 * `remainingPhotoSlots`, which is 1 for the diver who has already added seven
 * — a real singular hiding behind a name that reads like a bound. And
 * `cadenceEveryNWeeks` looked like a genuine bug and is not: `everyNWeeks` is
 * the code `recurrenceSummary` picks *only* when `intervalWeeks !== 1`, since
 * a one-week interval resolves to `weekly` or `daily` and never reaches this
 * string.
 */
const allowed = new Map([
  [
    "src/i18n/locales/en-US/diver.json:account.common.passwordErrors.tooLong",
    "A password bound. `MAX_PASSWORD_LENGTH` is 72; a one-character maximum is not a product we would ship.",
  ],
  [
    "src/i18n/locales/en-US/diver.json:account.common.passwordErrors.tooShort",
    "The same bound from below — a one-character minimum would be a bug in the constant, not in this string.",
  ],
  [
    "src/i18n/locales/en-US/diver.json:account.onboard.errors.ownerPasswordTooLong",
    "Sign-up's copy of the same bound.",
  ],
  [
    "src/i18n/locales/en-US/diver.json:account.onboard.errors.ownerPasswordTooShort",
    "Sign-up's copy of the same bound.",
  ],
  [
    "src/i18n/locales/es-ES/diver.json:account.common.passwordErrors.tooLong",
    "See the en-US twin: a password bound, never one.",
  ],
  [
    "src/i18n/locales/es-ES/diver.json:account.common.passwordErrors.tooShort",
    "See the en-US twin: a password bound, never one.",
  ],
  [
    "src/i18n/locales/es-ES/diver.json:account.onboard.errors.ownerPasswordTooLong",
    "See the en-US twin: a password bound, never one.",
  ],
  [
    "src/i18n/locales/es-ES/diver.json:account.onboard.errors.ownerPasswordTooShort",
    "See the en-US twin: a password bound, never one.",
  ],
  [
    "src/i18n/locales/en-US/staff/settings.json:import.errors.cellTooLongHeader",
    "A spreadsheet cell-length limit, in the thousands. The sentence exists to say a document was pasted into a cell.",
  ],
  [
    "src/i18n/locales/en-US/staff/settings.json:import.errors.cellTooLongRow",
    "The same limit, named for one row.",
  ],
  [
    "src/i18n/locales/es-ES/staff/settings.json:import.errors.cellTooLongHeader",
    "See the en-US twin: a cell-length limit in the thousands.",
  ],
  [
    "src/i18n/locales/es-ES/staff/settings.json:import.errors.cellTooLongRow",
    "See the en-US twin: a cell-length limit in the thousands.",
  ],
  [
    "src/i18n/locales/es-ES/staff/manifest.json:age",
    "A diver's age in years on a boat manifest. The youngest certification any agency issues is eight.",
  ],
  [
    "src/i18n/locales/es-ES/staff/manifest.json:minorAge",
    "The same age, badged as a minor. Same floor of eight.",
  ],
  [
    "src/i18n/locales/en-US/staff/schedule.json:builder.multiDayNote",
    "Rendered only inside `trip.dayCount > 1` (ScheduleBuilder's date Field description). At a day count of one there is no note.",
  ],
  [
    "src/i18n/locales/es-ES/staff/schedule.json:builder.multiDayNote",
    "See the en-US twin: guarded by `trip.dayCount > 1` at its one call site.",
  ],
  [
    "src/i18n/locales/en-US/staff/tripSeries.json:panel.cadenceEveryNWeeks",
    "`recurrenceSummary` picks the `everyNWeeks` code only when `intervalWeeks !== 1` (src/lib/recurrence.ts); a one-week interval resolves to `weekly` or `daily`, so this string never sees 1.",
  ],
  [
    "src/i18n/locales/es-ES/staff/tripSeries.json:panel.cadenceEveryNWeeks",
    "See the en-US twin: the cadence code itself excludes an interval of one.",
  ],
  [
    "src/i18n/locales/es-ES/staff/diveSites.json:list.manyRequiredSpecialties",
    "The `many` half of a hand-branched pair whose sibling is `oneRequiredSpecialty` rather than `…One`, so the structural rule below cannot see it. The dive-sites list branches on `requiredSpecialties.length === 1`.",
  ],
]);

/** Every offending value in one parsed bundle, with the count of strings read. */
export function findUninflectedCounts(bundle, { relative = "" } = {}) {
  const violations = [];
  let strings = 0;
  const seen = new Set();

  // Two passes: the second needs to know whether a `…One` sibling exists for a
  // `…Other` key, and JSON key order does not promise which comes first.
  const collect = (node, keyPath) => {
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node))
        collect(value, keyPath ? `${keyPath}.${key}` : key);
      return;
    }
    if (typeof node === "string") seen.add(keyPath);
  };
  collect(bundle, "");

  /**
   * A `fooOne`/`fooOther` pair is the plural handling, spelled by hand instead
   * of in ICU. Ugly, and correct — the call site picks the branch on the count,
   * so `fooOther`'s plural noun is only ever rendered for a plural. Converting
   * these to ICU is a separate cleanup and deliberately not this check's job
   * (issue #778). One half without the other is *not* a pair and is checked.
   */
  const handBranched = (keyPath) => {
    const pair = keyPath.endsWith("Other")
      ? `${keyPath.slice(0, -"Other".length)}One`
      : keyPath.endsWith("One")
        ? `${keyPath.slice(0, -"One".length)}Other`
        : null;
    return pair !== null && seen.has(pair);
  };

  const walk = (node, keyPath) => {
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        walk(value, keyPath ? `${keyPath}.${key}` : key);
      }
      return;
    }
    if (typeof node !== "string") return;
    strings += 1;
    if (handBranched(keyPath)) return;
    // A value that already reaches for ICU has made the decision, even if only
    // one of its several counts is wrapped — checking each count separately
    // would need a real ICU parse, and every message in this tree that carries
    // one plural carries them for all its counts.
    if (/\{\s*[a-zA-Z]+\s*,\s*plural\s*,/.test(node)) return;
    if (allowed.has(`${relative}:${keyPath}`)) return;
    for (const match of node.matchAll(COUNT_THEN_PLURAL)) {
      const [, first, second, word] = match;
      // The noun agrees with whichever number stands nearest it: in "3 of 8
      // divers" that is the second.
      const governing = second ?? first;
      if (!COUNT_NAMES.has(governing)) continue;
      violations.push({ keyPath, text: node, placeholder: governing, word });
      break;
    }
  };

  walk(bundle, "");
  return { violations, strings };
}

async function jsonFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await jsonFiles(full)));
    else if (entry.name.endsWith(".json")) found.push(full);
  }
  return found;
}

async function main() {
  const failures = [];
  const localesRoot = path.join(ROOT, LOCALES_DIR);
  let checked = 0;

  for (const file of (await jsonFiles(localesRoot)).sort()) {
    const relative = path.relative(ROOT, file);
    const result = findUninflectedCounts(JSON.parse(await readFile(file, "utf8")), { relative });
    checked += result.strings;
    for (const violation of result.violations) {
      failures.push(
        `${relative}: ${violation.keyPath} — {${violation.placeholder}} ${violation.word} = ` +
          JSON.stringify(violation.text.slice(0, 100)),
      );
    }
  }

  if (failures.length > 0) {
    console.error(
      "icu-plurals: a count is interpolated beside a word it does not inflect, so this renders " +
        '"1 bloqueados" / "1 seats open" the first time the count is one. Wrap it in an ICU ' +
        "plural — `{count, plural, one {# plaza} other {# plazas}}` — in every locale, or add " +
        "it to `allowed` in scripts/check-icu-plurals.mjs with the reason one is unreachable:\n" +
        failures.map((item) => `- ${item}`).join("\n"),
    );
    process.exit(1);
  }

  console.log(`icu-plurals: ${checked} strings inflect every count they interpolate`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
