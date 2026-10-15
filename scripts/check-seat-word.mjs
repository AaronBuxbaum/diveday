import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * **Everyone says "seat"** (H-122). The number a shop sells is a seat: the
 * schema (`trips.capacity`, `bookings` as seats), the capacity math in
 * `src/lib/trips.ts` and the glossary all say so. The staff pages had drifted
 * into both: the trip header read "4 spots left" beside "$95.00 per seat"
 * (third review, item 6, 2026-10-13). The diver's pages then did the same on
 * one screen: "Grab a spot", "Book these spots", then "You've got a seat";
 * `/ready` offered "Cancel my spot" beside "Your seat is still held" (fourth
 * review, item 7, 2026-10-14).
 *
 * So this refuses `spot` in every English staff bundle
 * (`src/i18n/locales/en-US/staff/*.json`) and in the diver bundle
 * (`src/i18n/locales/en-US/diver.json`). Spanish says `plaza` on both sides
 * and has no second word to drift into.
 *
 * `allowed` names each string where "spot" is right (a place, a mark on a
 * fish, the verb), and why.
 */

const ROOT = process.cwd();
const STAFF_DIR = "src/i18n/locales/en-US/staff";
const DIVER_BUNDLE = "src/i18n/locales/en-US/diver.json";

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
  [
    "diver.json:marineLife.species.barred-hamlet.tip",
    'a place: a hamlet "holds a spot" on the reef',
  ],
  ["diver.json:marineLife.species.hogfish.tip", 'the verb: "before you spot the fish"'],
  [
    "diver.json:marineLife.species.mutton-snapper.description",
    'a mark on the fish: "a small black spot high on the flank"',
  ],
  [
    "diver.json:marineLife.species.pederson-cleaner-shrimp.description",
    'a mark on the shrimp: "violet spots"',
  ],
  [
    "diver.json:marineLife.species.rock-beauty.tip",
    'a place: "it comes back out to the same spot"',
  ],
  ["diver.json:marineLife.species.rock-hind.description", 'a mark on the fish: "red-brown spots"'],
  [
    "diver.json:marineLife.species.spotted-moray.description",
    'a mark on the eel: "white peppered with dark spots"',
  ],
  [
    "diver.json:marineLife.species.threespot-damselfish.description",
    'a mark on the fish: "a black spot at the tail"',
  ],
  [
    "diver.json:marketing.featurePages.checkIn.summary",
    'the idiom "walk-ins added on the spot", meaning there and then',
  ],
]);

/** Every offending value in one parsed bundle, with the count of strings read. */
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
  const bundles = (await readdir(dir))
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((name) => ({ name, rel: `${STAFF_DIR}/${name}` }));
  bundles.push({ name: path.basename(DIVER_BUNDLE), rel: DIVER_BUNDLE });
  const failures = [];
  let checked = 0;
  for (const { name, rel } of bundles) {
    const result = findSpotWords(JSON.parse(await readFile(path.join(ROOT, rel), "utf8")), {
      file: name,
    });
    checked += result.strings;
    for (const violation of result.violations) {
      failures.push(
        `${rel}: ${violation.keyPath} = ${JSON.stringify(violation.text.slice(0, 90))}`,
      );
    }
  }
  if (failures.length > 0) {
    console.error(
      'seat word: a string says "spot". The number a shop sells is a "seat", for staff and ' +
        "divers alike (H-122; the schema, the capacity math and the glossary say so). Say seat, " +
        "or add the string to `allowed` in scripts/check-seat-word.mjs with why it means a " +
        "place, a mark or the verb rather than capacity:\n" +
        failures.map((item) => `- ${item}`).join("\n"),
    );
    process.exit(1);
  }
  console.log(`seat-word: ${checked} English staff and diver strings say seat, never spot`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
