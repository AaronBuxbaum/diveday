import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * **Staff say "seat".** The number a shop sells is a seat: the schema
 * (`trips.capacity`, `bookings` as seats), the capacity math in
 * `src/lib/trips.ts` and the glossary all say so. The diver's pages say
 * "spot", the warmer public word, and that is deliberate. The staff pages had
 * drifted into both: the trip header read "4 spots left" beside "$95.00 per
 * seat", Today "3 spots open" under a Schedule saying "67 of 124 seats", and
 * the cancel notice "The spot is open again … so the seat was non-refundable"
 * in one sentence (third review, item 6, 2026-10-13).
 *
 * So this refuses `spot` in every English staff bundle
 * (`src/i18n/locales/en-US/staff/*.json`). The diver bundle is not read.
 * Spanish says `plaza` on both sides and has no second word to drift into.
 *
 * `allowed` names the one staff string where "spot" is right, and why.
 */

const ROOT = process.cwd();
const STAFF_DIR = "src/i18n/locales/en-US/staff";

const PATTERN = /\bspots?\b/i;

/**
 * `file:key.path` -> why "spot" is the right word there. An entry is a claim
 * about who reads the string, so write the reason as if defending it.
 */
const allowed = new Map([
  [
    "incidents.json:form.locationHint",
    'a place, not capacity: "a spot on the reef" is where an incident happened',
  ],
]);

/** Every offending value in one parsed staff bundle, with the count of strings read. */
export function findSpotWords(bundle, { file = "" } = {}) {
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
    if (!PATTERN.test(node)) return;
    if (allowed.has(`${file}:${keyPath}`)) return;
    violations.push({ keyPath, text: node });
  };
  walk(bundle, "");
  return { violations, strings };
}

/** The allowlist entries, for the test that each still names a live string. */
export const allowedSpotStrings = [...allowed.keys()];

async function main() {
  const dir = path.join(ROOT, STAFF_DIR);
  const failures = [];
  let checked = 0;
  for (const name of (await readdir(dir)).filter((entry) => entry.endsWith(".json")).sort()) {
    const result = findSpotWords(JSON.parse(await readFile(path.join(dir, name), "utf8")), {
      file: name,
    });
    checked += result.strings;
    for (const violation of result.violations) {
      failures.push(
        `${STAFF_DIR}/${name}: ${violation.keyPath} = ${JSON.stringify(violation.text.slice(0, 90))}`,
      );
    }
  }
  if (failures.length > 0) {
    console.error(
      'seat word: a staff string says "spot". On staff surfaces the number a shop sells is a ' +
        '"seat" (the schema, the capacity math and the glossary say so); "spot" is the diver\'s ' +
        "word and lives in diver.json. Say seat, or add the string to `allowed` in " +
        "scripts/check-seat-word.mjs with why a diver reads it:\n" +
        failures.map((item) => `- ${item}`).join("\n"),
    );
    process.exit(1);
  }
  console.log(`seat-word: ${checked} English staff strings say seat, never spot`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
