import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * Two invariants (docs ADR 20260729-diver-copy-localization):
 *
 * 1. **No hard-coded locale.** A page formats dates, times, and money for the
 *    negotiated request locale, never a compiled-in `"en-US"`. A literal there
 *    is invisible in review and silently gives a Spanish-language shop US date
 *    order forever.
 * 2. **Every message is translated.** Each key in the default bundle exists in
 *    every other locale's bundle, with the same ICU placeholders, so a release
 *    can't ship one screen in Spanish and the next in English. This covers
 *    every bundle in `BUNDLES` — the diver surface, and since
 *    20260730-staff-copy-localization the staff surface as it migrates off
 *    inline English.
 *
 * Not checked here: copy that never reached a bundle at all. That was long
 * treated as undecidable, and it is not — `pnpm check:copy` scans JSX text and
 * human-readable attributes, and ratchets the remaining count down. The
 * division of labour is: this script proves what is extracted is translated,
 * `check:copy` proves nothing new goes un-extracted.
 *
 * Message-bundle coverage is scoped to the diver-facing surface. The waiver
 * body and the medical questionnaire are excluded from *translation* on
 * purpose — that wording is legally reviewed, and translating it is a sign-off
 * decision (H-01/H-03 in docs/product/human-decisions.md) — but their date
 * formatting is still covered by rule 1 above, which is why `/waivers` and
 * `/ready` are inside the guarded roots.
 */

const ROOT = process.cwd();
const LOCALES_DIR = "src/i18n/locales";
const DEFAULT_LOCALE = "en-US";

/**
 * Every message bundle, with the floor below which the bundle is presumed
 * broken rather than merely small. `staff.json` starts small on purpose — it
 * holds only the surfaces migrated off inline English so far, and
 * `pnpm check:copy` is what drives that number up.
 */
const BUNDLES = [
  { file: "diver.json", minimumKeys: 40 },
  { file: "staff.json", minimumKeys: 1 },
];

/**
 * Rendering code that must never name a locale itself. Scope is the whole UI —
 * `src/app` and `src/components` — not just the public pages: staff read dates
 * too, and a compiled-in `"en-US"` gives them US date order regardless of what
 * their device asks for.
 *
 * `src/lib` and `src/db` are out of scope by design: they *take* a locale as a
 * parameter (`formatShortDate(date, locale, tz)`), and a couple of them use a
 * fixed locale for parsing rather than display (`src/lib/zoned.ts` reads
 * `formatToParts` output, which must not vary).
 */
const guardedRoots = ["src/app", "src/components"];

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

/**
 * ICU argument names in a message — `{name}` and the `{count, plural, …}` head
 * alike, and *only* those.
 *
 * The nesting matters. A plural branch body is itself a brace group holding
 * ordinary text (`one {queda #}`), and matching every `{word` in the string
 * reads that text as two more arguments — which fails any translation whose
 * plural forms differ by more than the number, i.e. most of them outside
 * English. Argument names sit at even brace depth (an argument opens at depth
 * 0; its branch bodies open at depth 1; an argument nested inside a body opens
 * at depth 2), so depth is what tells the two apart.
 */
function placeholders(message) {
  const names = [];
  let depth = 0;
  const text = String(message);
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character !== "{") continue;
    if (depth % 2 === 0) {
      const name = /^\s*(\w+)/.exec(text.slice(index + 1));
      if (name) names.push(name[1]);
    }
    depth += 1;
  }
  return names.sort();
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
  for (const { file, minimumKeys } of BUNDLES) {
    const read = async (locale) =>
      flatten(JSON.parse(await readFile(path.join(ROOT, LOCALES_DIR, locale, file), "utf8")));
    const reference = await read(DEFAULT_LOCALE);
    const referenceKeys = Object.keys(reference);
    if (referenceKeys.length < minimumKeys) {
      violations.push(
        `${LOCALES_DIR}/${DEFAULT_LOCALE}/${file}: only ${referenceKeys.length} messages — expected at least ${minimumKeys}`,
      );
    }

    for (const locale of locales.filter((name) => name !== DEFAULT_LOCALE)) {
      const bundle = await read(locale);
      for (const key of referenceKeys) {
        if (!bundle[key]?.trim()) {
          violations.push(`${locale}/${file}: missing "${key}"`);
          continue;
        }
        const expected = placeholders(reference[key]).join(",");
        const actual = placeholders(bundle[key]).join(",");
        if (expected !== actual) {
          violations.push(`${locale}/${file}: "${key}" uses [${actual}], expected [${expected}]`);
        }
      }
      for (const key of Object.keys(bundle)) {
        if (!(key in reference))
          violations.push(`${locale}/${file}: stray "${key}" not in ${DEFAULT_LOCALE}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Localization violations:\n${violations.map((v) => `- ${v}`).join("\n")}`);
  console.error(
    "Pages format for the negotiated request locale and read copy from src/i18n/locales/<locale>/ (diver.json, staff.json); every message needs every locale.",
  );
  process.exit(1);
}

console.log(
  `locale: no compiled-in locales, and ${BUNDLES.map((b) => b.file).join(" + ")} are fully translated`,
);
