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
 * **"Retire" is on the list too**, and was the hole this check shipped with: the
 * ADR bans it by name, the regex did not, and the gear register was carrying a
 * Retire button — its own soft delete under a banned word — on the day the ADR
 * landed. The Spanish family (`retirar`, `retirado`) is unambiguous enough to
 * refuse outright; the ordinary sense of taking something away is `quitar` or
 * `sacar`, and both read better anyway.
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
const KEY_PATTERN = /archiv|unarchiv|deactivat|retir(?:e|ing|ed)|soft[-_]?delete/i;

/**
 * Per-locale value rules. English can afford the whole word family; Spanish
 * cannot (see the note above), so it names the three action forms — `archivar`
 * (the infinitive, only ever an action label here), `archivando`, and
 * `desarchivar`, which has no innocent meaning at all.
 *
 * ## The second half of the rule: the reassurance
 *
 * AGENTS.md bans two things, and the word list above only covered one. The
 * other is the sentence: "**No sentence explains which history survived**: a
 * caption reassuring the reader about an outcome they never doubted earns
 * nothing." Four strings on the diver record were in exactly that state while
 * this check passed, because the vocabulary that drifted there was not
 * `archive` at all (issue #779):
 *
 * - "Takes this diver off your active lists." — under a heading saying *Delete*
 *   and above a button saying *Delete Adaeze Nwosu*. The one sentence in the
 *   three that declined to say it.
 * - "Certification removed. It no longer counts toward readiness; **its history
 *   is kept for records**." — the forbidden sentence, verbatim, on a key
 *   already named `cardDeleted`.
 *
 * So the euphemism families join the word families. Both are anchored phrases
 * rather than single words: "active list" is fine in a heading about active
 * lists, and it is `off your active lists` *standing in for* "deleted" that is
 * the tell.
 *
 * ## Why a bare `remove` is **not** on these lists
 *
 * It would be wrong about sixty times. "Remove" is the correct word for taking
 * something *out of a collection it belongs to* — a landmark off a site's list,
 * a photo out of a gallery, a member out of a buddy team, a destination off the
 * backup list. In every one of those the thing removed still exists and the
 * sentence is honest.
 *
 * What is banned is *remove* standing in for *delete* of a first-class record,
 * and no pattern can tell those apart, because the difference is what kind of
 * thing the object is. A check for it would need the object's identity, which
 * means an allowlist of the ~60 legitimate sites — a list nobody would keep
 * accurate, and whose staleness would read as permission. The honest fix for
 * that class is the one already in place: the record's *action* words come from
 * a `remove`/`delete` block a reviewer reads whole, and AGENTS.md states the
 * rule in prose. If this drifts again, the shape worth building is a check over
 * the handful of blocks that name a destructive action, not a word ban.
 */
const VALUE_PATTERNS = new Map([
  [
    "en-US",
    /archiv|unarchiv|deactivat|retir(?:e|ing|ed)|soft[- ]?delete|(?:off|on|from|in) your active lists?\b|history is kept|kept for (?:records|your records)|no longer (?:appears|shows) (?:on|in) your active/i,
  ],
  [
    "es-ES",
    /desarchiv|archivar|archivand|retirar|retirad|(?:de|en|fuera de) (?:tus|sus|las) listas? activas?|historial se conserva|se conserva para (?:los )?registros/i,
  ],
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
