import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * **The Spanish words `src/i18n/locales/es-ES/README.md` has already settled.**
 *
 * That README exists because "every terminology decision below was made once
 * and is binding, which is what stops two agents rendering the same word two
 * ways". It does not stop them. The word it settled first came back anyway:
 * six strings were still calling the dive shop *la tienda* on 2026-08-21,
 * every one of them having survived the sweep meant to remove them — including
 * `common.certification.levelDescription`, the one sentence explaining why the
 * certification question is asked, on all three public forms at the point of
 * sale. This file started as a check for that word.
 *
 * On 2026-09-04 (issue #1316) a sweep found the same thing had happened to
 * four more of the README's decisions, so the check grew from one pattern to a
 * table. Each rule below is a decision the README states as binding, quoted at
 * the rule; none of them is a preference this file invented.
 *
 * **What is deliberately not here.** A rule needs a settled answer *and* a
 * pattern that cannot mean anything else. `comprobar`, `pulsar` and `coger` are
 * on the README's peninsular-vocabulary list and are absent from both bundles,
 * but each has an innocent reading in a compound; they are left to review. And
 * `viaje` is banned only in `staff/`, not in `diver.json`, which is the one
 * scoped rule here — see its own note.
 */

const ROOT = process.cwd();
const LOCALES_DIR = "src/i18n/locales";

/** The locales whose bundles have words that can be wrong this way. */
const LOCALES = new Set(["es-ES"]);

/** True for a staff-facing bundle: `es-ES/staff/<namespace>.json`. */
const isStaffBundle = (relative) => relative.includes(`${path.sep}staff${path.sep}`);

/**
 * Every settled decision this file can enforce mechanically.
 *
 * `scope` narrows a rule to some bundles; omitted, it covers every bundle in
 * `LOCALES`. `says` is printed verbatim under a failure, so it names the right
 * word rather than only the wrong one — a guard that reports "this is wrong"
 * and stops there gets satisfied by a synonym nobody chose either.
 */
const RULES = [
  {
    id: "shop",
    // Word-bounded on both sides: `trastienda` (a shop's back office, all over
    // the switching guides) and `entiendas` ("no firmes nada que no
    // entiendas", in the waiver's own notice) both contain the letters and
    // neither is the word. The README warns in as many words not to let a
    // find-and-replace eat the first of them.
    pattern: /\btiendas?\b/i,
    says: 'the dive shop is "el centro". "Tienda" means retail now, and "venta minorista" is the phrase when retail is what is meant',
  },
  {
    id: "waiver",
    // "One document, one word — settled 2026-08-14 … **'Descargo' is not a
    // synonym in this bundle** — it appears nowhere and should not come back."
    // `liberación` had drifted in beside it on five staff strings, three of
    // them sitting next to `paperWaiver.*` keys already saying `exención`.
    pattern: /\b(descargos?|liberaci[oó]n(es)?)\b/i,
    says: 'the waiver is "la exención", and the noun is feminine — every article and adjective reaching back to it moves with it (la, una, esta, firmada, archivada)',
  },
  {
    id: "dive-site",
    // "Three terms were live for the same row in `dive_sites`" and the
    // 2026-08-05 sweep settled `sitio de buceo`. Both losing spellings were
    // still in the tree on 2026-09-04, one of them as a settings heading
    // reading "Puntos de buceo" — the exact confusion the English fix removes,
    // a staffer picking a *punto* and then looking for it under *Sitios*.
    //
    // Narrow on purpose: `punto de venta` (POS) and the forecast's `punto de
    // pronóstico` are both correct and both survive this.
    pattern: /puntos? de (buceo|inmersi[oó]n)/i,
    says: 'a place you dive is "un sitio de buceo" — never "punto de buceo" or "punto de inmersión". One dive is "una inmersión"; "el punto" survives only for a literal coordinate',
  },
  {
    id: "quotes",
    // "Quotation marks are “ ”, not « ». Guillemets read as peninsular
    // typesetting; curly double quotes match both the English source and Latin
    // American usage."
    pattern: /[«»]/,
    says: "quotation marks are the curly double quotes “ ”, not guillemets « »",
  },
  {
    id: "vosotros",
    // "Tú, never vosotros. There are no `vosotros` forms in either bundle and
    // none should appear." The accent placement is what makes this safe to
    // match: `país` and `raíz` carry it on the i and do not match, while every
    // vosotros present-tense ending carries it on the a or e.
    pattern: /\w+(áis|éis)\b/i,
    says: "address one reader, not a group: tú forms only (revisa, toca, inténtalo), never vosotros",
  },
  {
    id: "departure",
    // Settled by usage rather than by an older sweep, and recorded in the
    // README on 2026-09-04: the staff bundles said `salida` 302 times and
    // `viaje` 7, so the seven were strays rather than a second convention.
    //
    // **Scoped to `staff/` deliberately.** `diver.json` uses `viaje` in its
    // marketing and switching prose, where the English is loose about it too
    // ("book a trip", "post-trip recap") and the word is doing a different job
    // — an outing a diver takes, not a row on the schedule board. Narrowing
    // that copy is a voice decision about diver-facing prose, not a
    // terminology violation, and it is not this file's to force.
    pattern: /\bviajes?\b/i,
    scope: isStaffBundle,
    says: 'a departure is "la salida" in the staff bundles, which say it 302 times against 7',
  },
];

/**
 * `file:key.path:rule` -> why this one is genuinely the other meaning. Empty on
 * purpose: every match found when each rule was written was the mistake it
 * describes. An entry here is a claim about what the reader is being told, so
 * write the reason as if defending it.
 */
const allowed = new Map([]);

/** Every offending value in one parsed bundle, with the count of strings read. */
export function findSettledTerms(bundle, { relative = "" } = {}) {
  const violations = [];
  let strings = 0;
  const rules = RULES.filter((rule) => !rule.scope || rule.scope(relative));

  const walk = (node, keyPath) => {
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        walk(value, keyPath ? `${keyPath}.${key}` : key);
      }
      return;
    }
    if (typeof node !== "string") return;
    strings += 1;
    for (const rule of rules) {
      if (!rule.pattern.test(node)) continue;
      if (allowed.has(`${relative}:${keyPath}:${rule.id}`)) continue;
      violations.push({ keyPath, text: node, rule: rule.id, says: rule.says });
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
    const result = findSettledTerms(JSON.parse(await readFile(file, "utf8")), { relative });
    checked += result.strings;
    for (const violation of result.violations) {
      failures.push(
        `${relative}: ${violation.keyPath} = ${JSON.stringify(violation.text.slice(0, 90))}\n` +
          `  ${violation.says}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(
      "shop word: a Spanish string uses a word src/i18n/locales/es-ES/README.md has already " +
        "settled against. That file is binding — read the section for the word before changing " +
        "either it or this check:\n" +
        failures.map((item) => `- ${item}`).join("\n"),
    );
    process.exit(1);
  }

  console.log(
    `shop-word: ${checked} Spanish strings keep the ${RULES.length} words the es-ES README settled`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
