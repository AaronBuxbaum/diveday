import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Enforces the settled Spanish terminology in
 * `src/i18n/locales/es-ES/README.md`; that README owns the decisions and
 * examples. The comments beside each rule retain only the matching boundary
 * that cannot be recovered from the vocabulary table.
 *
 * A term belongs here only when its meaning is settled and its pattern avoids
 * ordinary Spanish. `coger` remains review-only because of innocent readings.
 * `viaje` is refused only in `staff/`, not in diver-facing copy.
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
 * `LOCALES`. `keys` narrows it to strings whose key path matches, for a word
 * that is only wrong in one subject (`equipo` in a buddy-team string). One `id`
 * may have several rules, one per shape of the same mistake. `says` is printed verbatim under a failure, so it names the right
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
    // The README's waiver section settles one term: `exención`, not
    // `descargo` or `liberación`.
    pattern: /\b(descargos?|liberaci[oó]n(es)?)\b/i,
    says: 'the waiver is "la exención", and the noun is feminine — every article and adjective reaching back to it moves with it (la, una, esta, firmada, archivada)',
  },
  {
    id: "waiver",
    // Word-bounded so proper names like `Smartwaiver` and filenames like
    // `waiver_records.csv` remain valid.
    pattern: /\bwaivers?\b/i,
    says: 'the waiver is "la exención" in Spanish too: "Completa tu exención", "Exención firmada". The English word survives only inside a proper name or a file name',
  },
  {
    id: "dive-site",
    // The README settles `sitio de buceo`. Keep POS `punto de venta` and
    // forecast `punto de pronóstico` valid.
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
    // Scoped to `staff/`: there `viaje` means a scheduled departure. Diver
    // copy uses it for an outing and remains outside this terminology rule.
    pattern: /\bviajes?\b/i,
    scope: isStaffBundle,
    says: 'a departure is "la salida" in the staff bundles, which say it 302 times against 7',
  },
  {
    id: "press",
    // The README settles `presionar`; only these verb forms are refused.
    //
    // Anchored word-initial and enumerated by inflection on purpose:
    // `Impulso` (staff/promos.json) and `expulse` (diver.json's octopus tip)
    // both carry the letters mid-word, and `pulso` and `pulsera` are correct
    // nouns a medical or incident string may yet need.
    pattern: /\bpuls(a|as|ar|ad[oa]s?|ando)\b/i,
    says: 'you press a control: "presiona", "mantén presionado". "Pulsar" reads as Spain',
  },
  {
    id: "intro-session",
    // The README settles `bautismo` for an intro session; `iniciación` means
    // the entry-level course, which uses a different instructor ratio.
    //
    // Narrow on purpose, because `iniciación` keeps the entry-level sense:
    // `trips.depthWarningNoCard` says "el límite de iniciación" and is right,
    // and a real Open Water session is "una sesión del curso de iniciación",
    // which this does not take either.
    pattern: /\b(sesi[oó]n|ratio|clase)e?s? de iniciaci[oó]n/i,
    says: 'a taster dive (DSD/Try Scuba) is "un bautismo (de buceo)", masculine — "iniciación" is the entry-level course, which is the other ratio',
  },
  {
    id: "wetsuit",
    // The README settles `neopreno` for a wetsuit. Match only a size phrase
    // without `seco` or a bare `traje`; drysuit and swimsuit phrases remain valid.
    pattern: /\btallas? de trajes?\b(?!\s+secos?)|^trajes?$/i,
    says: 'the wetsuit is "el neopreno" — "Neopreno" on a kit list, "Talla de neopreno" on a fit form. "Traje" alone reads as the generic suit and sits one line from "Traje seco"',
  },
  {
    id: "check",
    // README:98, and its verificar/revisar paragraph at :100-103.
    //
    // Exclude the valid noun `comprobante`; include the `comprobar` /
    // `comprobación` family and stressed forms (`comprueba`, `compruébalo`).
    pattern: /\bcompr(?:ob(?!antes?\b)|u[eé]b)\w*/i,
    says: 'confirming a fact against evidence is "verificar"; looking something over is "revisar". "Comprobar/comprobación" reads as Spain',
  },
  {
    id: "manifest",
    // The README distinguishes the boat manifest (`manifiesto`) from a roster
    // (`listado`). Refuse only the manifest phrase; bare `listado` and its
    // ordinary participle remain valid.
    pattern: /\blistados? del? barcos?\b/i,
    says: 'the boat manifest is "el manifiesto" (masculine), as on every staff screen. "El listado" is a departure’s roster, which is a different list',
  },
  {
    id: "buddy-team",
    // The README settles `pareja de buceo` for a buddy team.
    //
    // Scoped to `staff/` for the gear-shaped phrase, because in diver.json
    // "alquiler de equipo de buceo" is the rental page and is right. Nothing
    // in the staff bundles calls gear that; it says "equipo de alquiler".
    pattern: /\bequipos? de buceo\b/i,
    scope: isStaffBundle,
    says: 'a buddy team is "una pareja de buceo" (feminine) — "equipo de buceo" reads as dive gear. The staff team stays "el equipo", gear stays "equipo de alquiler"',
  },
  {
    id: "buddy-team",
    // The marketing phrase, in any bundle: it can only mean a buddy team.
    pattern: /\bequipos? de compa[nñ]eros?\b/i,
    says: 'a buddy team is "una pareja de buceo" (feminine), on the public pages as on the Boat tab',
  },
  {
    id: "buddy-team",
    // The bare word in a string whose key is about buddy teams — "Equipo 01",
    // "Deshacer equipo", "Equipo: {names}". `keys` reads the key path, which is
    // the one place the bundle says what the string is about; the staff team
    // and gear keys never say "buddy".
    pattern: /\bequipos?\b/i,
    keys: /buddy/i,
    says: 'in a buddy-team string the word is "pareja" ("Pareja 01", "Deshacer pareja") — "equipo" is the staff team or the gear',
  },
  {
    id: "check-in",
    // The README settles `check-in` as the feature name; the control verbs
    // `Registrar` and `Registrado`, and a standalone record (`registro`), stay.
    pattern: /\bregistros? de llegadas?\b|\bllegada y registro\b/i,
    says: 'check-in is "el check-in" (the feature, the phase, "Llegada y check-in"); the tap on a row stays "Registrar"',
  },
  {
    id: "sign-up",
    // README's vocabulary table — "apuntarse (a una lista)" -> "inscribirse /
    // anotarse". The 2026-10-14 review found "Apuntándote…" on the wait-list
    // button one line under "Anótate en la lista de espera".
    //
    // Only the reflexive shapes, because the plain verb is innocent and in the
    // bundles: a backup endpoint "apunta a una dirección privada", the field
    // guide says "apunta tu luz" and "no le apuntes la luz a los ojos".
    pattern:
      /\bap[uú]nt(?:a(?:r|ndo)?|á(?:ndo)?)?(?:me|te|se|nos)\b|\b(?:me|te|se|nos)\s+ap[uú]nt\w*/i,
    says: 'joining a list is "anotarse" ("Anótate", "Anotándote…", "Anotarme en la lista de espera"). "Apuntarse" reads as Spain',
  },
  {
    id: "computer",
    // Enumerate the noun rather than matching a stem: `ordenada` and
    // `ordenado` (sorted) are valid forms.
    pattern: /\bordenador(es)?\b/i,
    says: 'a dive computer is "la computadora de buceo", and a desktop is "una computadora". "Ordenador" reads as Spain',
  },
  {
    id: "parking",
    // The README settles `estacionamiento` for parking.
    pattern: /\baparca(mientos?|r)\b/i,
    says: 'parking is "el estacionamiento" ("Estacionamiento: {parking}"). "Aparcamiento" reads as Spain',
  },
  {
    id: "mobile",
    // The README settles `celular` for a mobile phone.
    //
    // Word-initial on purpose: `inmóvil` (a barracuda holding still in the
    // field guide) and `automóvil` carry the letters and are not the phone.
    pattern: /\bm[oó]vil(es)?\b/i,
    says: 'a mobile phone is "el celular" ("número de celular", "Celular o fijo"). "Móvil" reads as Spain',
  },
  {
    id: "add",
    // The README settles `agregar` for the add action. Word-initial matching
    // avoids `bañador` (`ñad` occurs inside that valid word).
    pattern: /\bañad/i,
    says: 'adding is "agregar" ("Agregar buzo", "agregado"). "Añadir" reads as Spain',
  },
];

/**
 * `file:key.path:rule` -> why this one is genuinely the other meaning. Empty on
 * purpose: every match found when each rule was written was the mistake it
 * describes. An entry here is a claim about what the reader is being told, so
 * write the reason as if defending it.
 */
const allowed = new Map([]);

/**
 * The string without its ICU case keys: a bare word right before a `{`, inside
 * an argument (`{reason, select, waiver {…}}`). Text outside every brace keeps
 * its words, so "tu waiver {tripTitle}" is still read whole.
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
    const reported = new Set();
    // An ICU `select` case key (`waiver {: exención}`) is a code the reader
    // never sees, so it is read with its keys taken out.
    const read = withoutCaseKeys(node);
    for (const rule of rules) {
      if (rule.keys && !rule.keys.test(keyPath)) continue;
      if (reported.has(rule.id) || !rule.pattern.test(read)) continue;
      if (allowed.has(`${relative}:${keyPath}:${rule.id}`)) continue;
      reported.add(rule.id);
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
    `shop-word: ${checked} Spanish strings keep the ${new Set(RULES.map((rule) => rule.id)).size} words the es-ES README settled`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
