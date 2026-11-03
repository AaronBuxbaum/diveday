import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * **A word the product says once is written once** (issue #2770, docs ADR 20260908-one-hand).
 *
 * `locales/<locale>/words.json` holds the invariant words: a progress verb (`words.busy.saving`),
 * a dismissal (`words.dismiss.neverMind`), a speech act (`words.did.copied`). A staff key whose
 * en-US value is one of those values is a second hand-written copy of the same word, and 63
 * spellings of "Saving…" is how the bundle got there. This refuses a new one: use the `words.*`
 * key.
 *
 * Scope: the staff bundles. The diver bundle still holds its own spellings; the guard widens to
 * it when that migration lands.
 *
 * A key that genuinely needs its own value (a participle that agrees in Spanish with its noun)
 * is named in `EXEMPT` with the reason.
 */

const ROOT = process.cwd();
const LOCALE_DIR = "src/i18n/locales/en-US";

/** `<file>:<key>` entries with the reason their own spelling stays. */
export const EXEMPT = new Map([
  [
    "schedule:notices.copied",
    "Spanish agrees with its noun (Copiada); the English value is the same word.",
  ],
]);

function* leaves(node, prefix = "") {
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string") yield [`${prefix}${key}`, value];
    else if (value && typeof value === "object") yield* leaves(value, `${prefix}${key}.`);
  }
}

/** Every `{ key, value }` of the words bundle. */
export function wordValues(words) {
  return new Map([...leaves(words)].map(([key, value]) => [value, `words.${key}`]));
}

/** Staff keys (`<namespace>:<key>`) that spell a words value themselves. */
export function findRepeats(words, bundles, exempt = EXEMPT) {
  const byValue = wordValues(words);
  const repeats = [];
  for (const [namespace, bundle] of Object.entries(bundles)) {
    for (const [key, value] of leaves(bundle)) {
      const id = `${namespace}:${key}`;
      const owner = byValue.get(value);
      if (owner && !exempt.has(id)) repeats.push({ id, value, owner });
    }
  }
  return repeats;
}

async function main() {
  const words = JSON.parse(await readFile(path.join(ROOT, LOCALE_DIR, "words.json"), "utf8"));
  const dir = path.join(ROOT, LOCALE_DIR, "staff");
  const bundles = {};
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
    bundles[file.replace(/\.json$/, "")] = JSON.parse(await readFile(path.join(dir, file), "utf8"));
  }
  const repeats = findRepeats(words, bundles);
  if (repeats.length === 0) {
    console.log(`words: no staff key repeats a words.* value (${wordValues(words).size} words)`);
    return;
  }
  console.error("words: these staff keys spell a word `words.json` already holds:");
  for (const { id, value, owner } of repeats) {
    console.error(`  ${id} = ${JSON.stringify(value)}  ->  use t("${owner}")`);
  }
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
