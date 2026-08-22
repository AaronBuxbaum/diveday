import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * In Spanish, a dive shop is **el centro**. It is never "la tienda".
 *
 * `src/i18n/locales/es-ES/README.md` settled this in a 2026-08-03 sweep and
 * states it as binding: one entity, one word. "Tienda" is not banned — it means
 * *retail* now, and where the English says retail the Spanish says `venta
 * minorista`. That distinction is the whole point of taking the word off the
 * entity: a string saying `la tienda` tells a diver their **retail store** will
 * check their certification.
 *
 * The README already explains why this needs a check rather than a rule:
 * its decisions are binding "which is what stops two agents rendering the same
 * word two ways", and the word came back anyway. Six strings were carrying it
 * on 2026-08-21 — including `common.certification.levelDescription`, the one
 * sentence explaining why the certification question is asked, on all three
 * public forms at the point of sale — and every one of them had survived the
 * sweep that was supposed to have removed them.
 *
 * **`trastienda` is a different word and stays.** A shop's back office, as
 * opposed to the counter; the competitive switching guides are full of it
 * ("el PC de la trastienda"). The README warns in as many words not to let a
 * find-and-replace on "tienda" eat it, which is exactly what a naive substring
 * rule would do — so the pattern is anchored on a word boundary. The same
 * boundary is what keeps `entiendas` out ("no firmes nada que no entiendas"),
 * a false positive a substring rule hits on the waiver's own English-only
 * notice.
 *
 * Only `es-ES` has an entity word to get wrong, so unlike
 * `check-soft-delete.mjs` this does not demand a word list per locale. A new
 * Spanish-family locale should be added to `LOCALES` when it arrives.
 */

const ROOT = process.cwd();
const LOCALES_DIR = "src/i18n/locales";

/** The locales whose bundles have a word for the shop that can be wrong. */
const LOCALES = new Set(["es-ES"]);

/**
 * Word-bounded on both sides: `trastienda` and `entiendas` both contain the
 * letters and neither is the word.
 */
const SHOP_WORD = /\btiendas?\b/i;

/**
 * `file:key.path` -> why this one genuinely means a retail store. Empty on
 * purpose: every use found when this check was written meant the dive shop. An
 * entry here is a claim that the reader is being told about retail, so write
 * the reason as if defending it.
 */
const allowed = new Map([]);

/** Every offending value in one parsed bundle, with the count of strings read. */
export function findShopWord(bundle, { relative = "" } = {}) {
  const violations = [];
  let strings = 0;

  const walk = (node, keyPath) => {
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        walk(value, keyPath ? `${keyPath}.${key}` : key);
      }
      return;
    }
    if (typeof node !== "string") return;
    strings += 1;
    if (SHOP_WORD.test(node) && !allowed.has(`${relative}:${keyPath}`)) {
      violations.push({ keyPath, text: node });
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
    const locale = path.relative(localesRoot, file).split(path.sep)[0];
    if (!LOCALES.has(locale)) continue;
    const relative = path.relative(ROOT, file);
    const result = findShopWord(JSON.parse(await readFile(file, "utf8")), { relative });
    checked += result.strings;
    for (const violation of result.violations) {
      failures.push(
        `${relative}: ${violation.keyPath} = ${JSON.stringify(violation.text.slice(0, 90))}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(
      "shop word: a Spanish string calls the dive shop a retail store " +
        '(src/i18n/locales/es-ES/README.md — the shop is "el centro"; "tienda" means retail, ' +
        'and "venta minorista" is the phrase when retail is what is meant):\n' +
        failures.map((item) => `- ${item}`).join("\n"),
    );
    process.exit(1);
  }

  console.log(`shop-word: ${checked} Spanish strings call the shop el centro, never la tienda`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
