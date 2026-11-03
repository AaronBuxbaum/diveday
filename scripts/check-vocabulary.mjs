// **A concept is said one way per locale**: no message bundle uses a word `config/vocabulary.mjs`
// refuses for it.
//
// The table is the glossary's settled words (the glossary index opens with it). This guard reads
// each row's `refuse` list and every bundle under `src/i18n/locales/<locale>/`, and reports the
// string, the word it should have said, and the row. It replaces two one-off word guards: the
// es-ES terminology check (`tienda` and the rest, issue #1316) and the seat word
// (H-20261014-seat-is-the-word), whose rules are now rows with zero change in what they refuse.
//
// A string that genuinely means the other thing goes in its row's `allow`, with the reason.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { VOCABULARY } from "../config/vocabulary.mjs";

const ROOT = process.cwd();
const LOCALES_DIR = "src/i18n/locales";

/** Every refusal, flattened, each carrying its row's id and allowances. */
export function refusals(vocabulary = VOCABULARY) {
  return vocabulary.flatMap((row) =>
    row.refuse.map((rule) => ({ ...rule, id: row.id, allow: row.allow ?? {} })),
  );
}

/** The locales any row refuses a word in: only their bundles are read. */
export const LOCALES = [...new Set(refusals().map((rule) => rule.locale))].sort();

/**
 * The string without its ICU case keys: a bare word right before a `{`, inside an argument
 * (`{reason, select, waiver {…}}`). Text outside every brace keeps its words, so "tu waiver
 * {tripTitle}" is still read whole.
 */
function withoutCaseKeys(text) {
  let out = "";
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (depth > 0 && /[A-Za-z_]/.test(char) && /[{}\s,]/.test(text[i - 1] ?? "")) {
      const key = /^[\w-]+(?=\s*\{)/.exec(text.slice(i));
      if (key) {
        i += key[0].length - 1;
        continue;
      }
    }
    if (char === "{") depth += 1;
    if (char === "}") depth = Math.max(0, depth - 1);
    out += char;
  }
  return out;
}

function isAllowed(allow, where) {
  return Object.keys(allow).some((key) =>
    key.endsWith(".") ? where.startsWith(key) : where === key,
  );
}

/**
 * Every offending value in one parsed bundle, with the count of strings read. `file` is the
 * bundle's path under its locale directory (`diver.json`, `staff/trips.json`,
 * `content/marketing.json`).
 */
export function findRefusedWords(bundle, { locale = "es-ES", file = "diver.json" } = {}) {
  const violations = [];
  let strings = 0;
  const rules = refusals().filter(
    (rule) => rule.locale === locale && (!rule.scope || rule.scope(file)),
  );

  const walk = (node, keyPath) => {
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        walk(value, keyPath ? `${keyPath}.${key}` : key);
      }
      return;
    }
    if (typeof node !== "string") return;
    strings += 1;
    const reported = new Set();
    // An ICU `select` case key (`waiver {: exención}`) is a code the reader never sees, so it is
    // read with its keys taken out.
    const read = withoutCaseKeys(node);
    for (const rule of rules) {
      if (rule.keys && !rule.keys.test(keyPath)) continue;
      if (reported.has(rule.id) || !rule.pattern.test(read)) continue;
      if (isAllowed(rule.allow, `${file}:${keyPath}`)) continue;
      reported.add(rule.id);
      violations.push({ keyPath, text: node, rule: rule.id, says: rule.says });
    }
  };

  walk(bundle, "");
  return { violations, strings };
}

/** Every allowance, as `{ id, locale, entry }`, for the test that each still names a live string. */
export function allowances(vocabulary = VOCABULARY) {
  return vocabulary.flatMap((row) =>
    Object.keys(row.allow ?? {}).map((entry) => ({
      id: row.id,
      locales: [...new Set(row.refuse.map((rule) => rule.locale))],
      entry,
    })),
  );
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
  let checked = 0;
  for (const locale of LOCALES) {
    const localeRoot = path.join(ROOT, LOCALES_DIR, locale);
    for (const full of (await jsonFiles(localeRoot)).sort()) {
      const file = path.relative(localeRoot, full).split(path.sep).join("/");
      const result = findRefusedWords(JSON.parse(await readFile(full, "utf8")), { locale, file });
      checked += result.strings;
      for (const violation of result.violations) {
        failures.push(
          `${path.relative(ROOT, full)}: ${violation.keyPath} = ${JSON.stringify(violation.text.slice(0, 90))}\n` +
            `  ${violation.rule}: ${violation.says}`,
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error(
      "vocabulary: a string uses a word config/vocabulary.mjs settled against (the table that opens " +
        "docs/product/glossary.md; the Spanish reasoning is src/i18n/locales/es-ES/README.md). " +
        "Say the row's word, or add the string to the row's `allow` with why it means something else:\n" +
        failures.map((item) => `- ${item}`).join("\n"),
    );
    process.exit(1);
  }

  console.log(
    `vocabulary: ${checked} ${LOCALES.join(" and ")} strings keep the ${VOCABULARY.length} settled words`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
