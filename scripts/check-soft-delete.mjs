import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * A shop never reads the word "archive" for something it asked to delete.
 *
 * Deletion in DiveDay is soft everywhere (ADR 20260820-every-delete-is-soft):
 * the row keeps its history behind a `deleted_at`, so a mis-tap on a Tuesday is
 * recoverable on a Wednesday. That is a promise we keep for the shop, not a
 * concept they should have to hold — and until 2026-08-20 it was on their
 * screen instead, as 49 strings saying Archive, Unarchive, Archived, Archiving,
 * each trailed by a sentence explaining which history survived. The person
 * clicking it wanted the diver gone from their lists; "Archive" made them stop
 * and work out whether that was the same thing.
 *
 * The vocabulary came back twice on its own before it was checked, because it
 * is what the storage model is called *in the code* — `archiveCertification`,
 * `waiver_templates.archived_at` — and the copy drifts toward the code that
 * calls it. Internal names are out of scope here and deliberately so: nobody
 * reads them. This guards the one door user-facing words come through, the
 * message bundles under `src/i18n/locales/` (`pnpm check:copy` guards the
 * other, by refusing hard-coded copy in a component at all).
 *
 * Both halves of a bundle are checked, values *and* key names, because a key
 * named `archiveSite` is what the next author reads before writing the string
 * under it.
 *
 * Spanish needs its own word list rather than a translation of the English one:
 * `archivo` is the ordinary word for a *file*, and the marketing and import
 * copy is full of it ("guarda el archivo", "44 archivos"). Only the unambiguous
 * action forms are refused there. A locale with no word list is a failure, not
 * a pass — a third language must state its own rather than slip through.
 */

const ROOT = process.cwd();
const LOCALES_DIR = "src/i18n/locales";

/**
 * Key names are shared across locales, so they are held to the English list
 * once, wherever they appear.
 */
const KEY_PATTERN = /archiv|unarchiv|deactivat|soft[-_]?delete/i;

/**
 * Per-locale value rules. English can afford the whole word family; Spanish
 * cannot (see the note above), so it names the three action forms — `archivar`
 * (the infinitive, only ever an action label here), `archivando`, and
 * `desarchivar`, which has no innocent meaning at all.
 */
const VALUE_PATTERNS = new Map([
  ["en-US", /archiv|unarchiv|deactivat|soft[- ]?delete/i],
  ["es-ES", /desarchiv|archivar|archivand/i],
]);

/**
 * `file:key.path` -> why this one is not the delete action. Empty on purpose:
 * every use found when this check was written was the delete action. An entry
 * here is a claim that a reader could not mistake the word for one, so write
 * the reason as if defending it.
 */
const allowed = new Map([]);

/**
 * The rule itself, over one parsed bundle. Returns a violation per offending
 * key name or string value, deepest key path first seen; an unknown locale
 * raises rather than returning nothing, so a new language cannot pass by
 * default.
 */
export function findArchiveVocabulary(bundle, locale, { relative = "" } = {}) {
  const valuePattern = VALUE_PATTERNS.get(locale);
  if (!valuePattern) throw new UnknownLocaleError(locale);

  const violations = [];
  let strings = 0;

  const walk = (node, keyPath) => {
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        const next = keyPath ? `${keyPath}.${key}` : key;
        if (KEY_PATTERN.test(key) && !allowed.has(`${relative}:${next}`)) {
          violations.push({ keyPath: next, kind: "key", text: key });
        }
        walk(value, next);
      }
      return;
    }
    if (typeof node !== "string") return;
    strings += 1;
    if (valuePattern.test(node) && !allowed.has(`${relative}:${keyPath}`)) {
      violations.push({ keyPath, kind: "value", text: node });
    }
  };

  walk(bundle, "");
  return { violations, strings };
}

export class UnknownLocaleError extends Error {
  constructor(locale) {
    super(
      `locale "${locale}" has no word list in scripts/check-soft-delete.mjs — add one naming ` +
        `the delete-vocabulary forms that are unambiguous in that language`,
    );
    this.locale = locale;
  }
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
    const locale = path.relative(localesRoot, file).split(path.sep)[0];
    let result;
    try {
      result = findArchiveVocabulary(JSON.parse(await readFile(file, "utf8")), locale, {
        relative,
      });
    } catch (error) {
      if (!(error instanceof UnknownLocaleError)) throw error;
      failures.push(`${relative}: ${error.message}`);
      continue;
    }
    checked += result.strings;
    for (const violation of result.violations) {
      failures.push(
        violation.kind === "key"
          ? `${relative}: key "${violation.keyPath}" — the word is delete, never archive`
          : `${relative}: ${violation.keyPath} = ${JSON.stringify(violation.text.slice(0, 90))}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(
      "soft-delete vocabulary: a user-facing string calls a delete something else " +
        "(ADR 20260820-every-delete-is-soft — deletion is soft underneath, and still says " +
        '"Delete" on top; "Restore", never "Unarchive"):\n' +
        failures.map((item) => `- ${item}`).join("\n"),
    );
    process.exit(1);
  }

  console.log(`soft-delete: ${checked} message strings say delete, not archive`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
