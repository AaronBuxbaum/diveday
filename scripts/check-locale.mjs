import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * Two invariants for the diver-facing surface (docs ADR
 * 20260729-diver-copy-localization):
 *
 * 1. **No hard-coded locale.** A diver-facing page formats dates, times, and
 *    money for the *shop's* locale (`shops.default_locale`), never a
 *    compiled-in `"en-US"`. A literal there is invisible in review and
 *    silently gives a Spanish-language shop US date order forever.
 * 2. **Every message is translated.** Each key in the default bundle exists in
 *    every other locale's bundle, with the same ICU placeholders, so a release
 *    can't ship one screen in Spanish and the next in English.
 *
 * Deliberately not checked: that no English string literal appears anywhere in
 * a diver-facing component. That is not mechanically decidable (a className, a
 * test id, and a sentence are all string literals), so it stays a review
 * expectation. What *is* decidable is checked here.
 *
 * Scope is the public booking surface and the recap. `/waivers` and `/ready`
 * are excluded on purpose: their copy is legally reviewed, and translating it
 * is a sign-off decision (H-01/H-03 in docs/product/human-decisions.md), so
 * they still format for `en-US` by design until that clears.
 */

const ROOT = process.cwd();
const LOCALES_DIR = "src/i18n/locales";
const DEFAULT_LOCALE = "en-US";
const BUNDLE = "diver.json";

/** Diver-facing files that must never name a locale themselves. */
const guardedRoots = [
  "src/app/shop/[shopSlug]/schedule",
  "src/app/shop/[shopSlug]/courses",
  "src/app/recap",
];

const sourceExtensions = new Set([".ts", ".tsx"]);
const localeLiteral = /["'`]en-US["'`]/;

async function walk(relativeDirectory) {
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
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (
      sourceExtensions.has(path.extname(entry.name)) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      files.push(relativePath);
    }
  }
  return files;
}

/** Every leaf as `dotted.path` → message. */
function flatten(node, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") Object.assign(out, flatten(value, dotted));
    else out[dotted] = value;
  }
  return out;
}

/** ICU argument names in a message — `{name}` and the `{count, plural, …}` head alike. */
function placeholders(message) {
  return [...String(message).matchAll(/\{\s*(\w+)/g)].map((match) => match[1]).sort();
}

const violations = [];

for (const root of guardedRoots) {
  for (const file of await walk(root)) {
    const contents = await readFile(path.join(ROOT, file), "utf8");
    contents.split("\n").forEach((line, index) => {
      if (localeLiteral.test(line)) {
        violations.push(`${file}:${index + 1}: hard-coded locale — ${line.trim()}`);
      }
    });
  }
}

const locales = (await readdir(path.join(ROOT, LOCALES_DIR), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

if (!locales.includes(DEFAULT_LOCALE)) {
  violations.push(`${LOCALES_DIR}: no ${DEFAULT_LOCALE} bundle`);
} else {
  const read = async (locale) =>
    flatten(JSON.parse(await readFile(path.join(ROOT, LOCALES_DIR, locale, BUNDLE), "utf8")));
  const reference = await read(DEFAULT_LOCALE);
  const referenceKeys = Object.keys(reference);
  if (referenceKeys.length < 40) {
    violations.push(
      `${LOCALES_DIR}/${DEFAULT_LOCALE}/${BUNDLE}: only ${referenceKeys.length} messages — the diver surface should carry more than that`,
    );
  }

  for (const locale of locales.filter((name) => name !== DEFAULT_LOCALE)) {
    const bundle = await read(locale);
    for (const key of referenceKeys) {
      if (!bundle[key]?.trim()) {
        violations.push(`${locale}: missing "${key}"`);
        continue;
      }
      const expected = placeholders(reference[key]).join(",");
      const actual = placeholders(bundle[key]).join(",");
      if (expected !== actual) {
        violations.push(`${locale}: "${key}" uses [${actual}], expected [${expected}]`);
      }
    }
    for (const key of Object.keys(bundle)) {
      if (!(key in reference))
        violations.push(`${locale}: stray "${key}" not in ${DEFAULT_LOCALE}`);
    }
  }
}

if (violations.length > 0) {
  console.error(`Localization violations:\n${violations.map((v) => `- ${v}`).join("\n")}`);
  console.error(
    "Diver-facing pages format for the shop's locale and read copy from src/i18n/locales/<locale>/diver.json; every message needs every locale.",
  );
  process.exit(1);
}

console.log("locale: diver-facing copy is locale-driven and fully translated");
