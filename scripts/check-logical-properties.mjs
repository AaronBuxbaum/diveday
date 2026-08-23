import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * **Layout that does not care which way the page reads.**
 *
 * `src/components` alone carries ~190 logical directional utilities — `ms-`,
 * `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`, `text-end` — against a
 * few dozen physical ones. Somebody has been writing direction-agnostic layout
 * for a long time, and nothing protected it: `check:tokens` guards colour,
 * `check:timezone` guards time, and this was a convention held in the heads of
 * whoever happened to have read the neighbouring file (issue #733).
 *
 * The stakes are small today and that is the point. DiveDay ships two locales
 * and both read left to right, so `ml-2` and `ms-2` render identically and a
 * physical utility costs nothing. It costs a lot later, all at once, on the day
 * a third locale arrives — which is exactly the shape of debt a ratchet is for.
 *
 * **This does not claim RTL support.** `<html dir>` is derived now (issue
 * #733) so `globals.css`'s `:dir(rtl)` rule can match at all, and the layout is
 * *written* to be direction-agnostic — but no RTL locale ships and nobody has
 * looked at the app in one. See docs/design/principles.md.
 *
 * The escape hatch is a baseline entry, never an inline comment:
 * `logical-properties-baseline.json` records how many physical utilities a
 * file still carries. A file not in the baseline may have none, a count may
 * never rise, and a fall must be banked in the same change (`--write`, which
 * refuses to raise anything; `--absorb` records growth arriving from a merge).
 * The grandfathered ones are left alone deliberately: several are legitimate —
 * a decorative offset, a print rule — and a bulk rewrite is churn with no
 * user-visible effect.
 */

const ROOT = process.cwd();
export const BASELINE_PATH = "scripts/logical-properties-baseline.json";
const guardedRoots = ["src/app", "src/components", "src/features"];
const sourceExtensions = new Set([".ts", ".tsx"]);

/**
 * The physical utilities that have a logical twin, and only those. `top-`,
 * `bottom-`, `mt-`, `mb-` and friends are not directional — a page reads down
 * in every locale DiveDay could ever ship — so they are not here.
 */
const PHYSICAL = [
  ["ml-", "ms-"],
  ["mr-", "me-"],
  ["pl-", "ps-"],
  ["pr-", "pe-"],
  ["left-", "start-"],
  ["right-", "end-"],
  ["text-left", "text-start"],
  ["text-right", "text-end"],
  ["border-l", "border-s"],
  ["border-r", "border-e"],
  ["rounded-l", "rounded-s"],
  ["rounded-r", "rounded-e"],
];

/**
 * A utility inside a class string, with its optional variants — `sm:ml-2`,
 * `group-hover:pr-4`, `-ml-1`. Anchored on a boundary so `border-r` does not
 * match `border-red-500`, and `left-` does not match a word ending in "left".
 */
const patternFor = (utility) =>
  new RegExp(
    `(?<![\\w-])-?(?:[a-z-]+:)*${utility.replace(/-$/, "-")}${utility.endsWith("-") ? "[\\w./\\[\\]%-]+" : ""}(?![\\w-])`,
    "g",
  );

/**
 * Comments out, before anything is counted. Prose is full of "right-hand" and
 * "left-aligned", and neither is a class — the same reason `check-tokens.mjs`
 * strips first. Replaced with spaces rather than removed so line numbers in
 * the report still point at the real line.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + " ".repeat(match.length - lead.length));
}

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
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

const details = new Map();
for (const root of guardedRoots) {
  for (const file of await walk(root)) {
    const contents = stripComments(await readFile(path.join(ROOT, file), "utf8"));
    const hits = [];
    contents.split("\n").forEach((line, index) => {
      for (const [physical, logical] of PHYSICAL) {
        for (const match of line.matchAll(patternFor(physical))) {
          hits.push({ line: index + 1, text: match[0], logical });
        }
      }
    });
    if (hits.length > 0) details.set(file, hits);
  }
}

const reportIndex = process.argv.indexOf("--report");
if (reportIndex !== -1) {
  const prefix = process.argv[reportIndex + 1] ?? "";
  let shown = 0;
  for (const [file, hits] of details) {
    if (!file.startsWith(prefix)) continue;
    console.log(`\n${file} (${hits.length})`);
    for (const hit of hits) console.log(`  ${hit.line}\t${hit.text}\t→ ${hit.logical}`);
    shown += hits.length;
  }
  console.log(`\n${shown} physical directional utilities under "${prefix || "src"}"`);
  process.exit(0);
}

let baseline = {};
let baselineExists = true;
try {
  baseline = JSON.parse(await readFile(path.join(ROOT, BASELINE_PATH), "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  baselineExists = false;
}
const baselineCounts = Object.fromEntries(
  Object.entries(baseline).filter(([key]) => !key.startsWith("//")),
);

const absorbing = process.argv.includes("--absorb");
if (process.argv.includes("--write") || absorbing) {
  const grew = [...details.entries()].filter(
    ([file, hits]) => baselineExists && hits.length > (baselineCounts[file] ?? 0),
  );
  if (grew.length > 0 && !absorbing) {
    console.error(
      "Refusing to write a baseline that grows. The ratchet only turns one way — use the logical utility instead:",
    );
    for (const [file, hits] of grew) {
      console.error(`- ${file}: ${baselineCounts[file] ?? 0} → ${hits.length}`);
    }
    console.error(
      "If this growth arrived in a merge from a branch that predates the check, `--absorb` records it explicitly.",
    );
    process.exit(1);
  }
  if (grew.length > 0) {
    console.warn("Absorbing values that grew — this must be merged-in work, not new debt:");
    for (const [file, hits] of grew) {
      console.warn(`- ${file}: ${baselineCounts[file] ?? 0} → ${hits.length}`);
    }
  }
  const next = {
    "//": "Physical directional utilities still in components, per file. Written by `node scripts/check-logical-properties.mjs --write`. This number may only go down — see scripts/check-logical-properties.mjs. Use ms-/me-/ps-/pe-/start-/end-/text-start/text-end instead.",
    ...Object.fromEntries(
      [...details.entries()]
        .map(([file, hits]) => [file, hits.length])
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  await writeFile(path.join(ROOT, BASELINE_PATH), `${JSON.stringify(next, null, 2)}\n`);
  const total = [...details.values()].reduce((sum, hits) => sum + hits.length, 0);
  console.log(`logical-properties: baseline written — ${details.size} files, ${total} utilities`);
  process.exit(0);
}

const violations = [];
for (const [file, hits] of details) {
  const allowed = baselineCounts[file];
  if (allowed === undefined) {
    const sample = hits
      .slice(0, 5)
      .map((hit) => `\n    ${file}:${hit.line}  ${hit.text} → ${hit.logical}`)
      .join("");
    violations.push(
      `${file}: ${hits.length} physical directional utilit${hits.length === 1 ? "y" : "ies"} in a file with no baseline entry.${sample}`,
    );
    continue;
  }
  if (hits.length > allowed) {
    violations.push(
      `${file}: ${hits.length} physical directional utilities, baseline allows ${allowed}. Use the logical twin instead of raising the number.`,
    );
  }
  if (hits.length < allowed) {
    violations.push(
      `${file}: down to ${hits.length} from ${allowed} — lower the baseline in this change (\`node scripts/check-logical-properties.mjs --write\`).`,
    );
  }
}
for (const file of Object.keys(baselineCounts)) {
  if (!details.has(file)) {
    violations.push(
      `${file}: clean or gone — remove its baseline entry (\`node scripts/check-logical-properties.mjs --write\`).`,
    );
  }
}

if (violations.length > 0) {
  console.error(`Physical directional utilities:\n${violations.map((v) => `- ${v}`).join("\n")}`);
  console.error(
    "Logical properties follow the writing direction: ms-/me-, ps-/pe-, start-/end-, text-start/text-end, border-s/border-e, rounded-s/rounded-e. See docs/design/principles.md.",
  );
  process.exit(1);
}

const total = [...details.values()].reduce((sum, hits) => sum + hits.length, 0);
console.log(
  `logical-properties: layout stays direction-agnostic — ${total} grandfathered physical utilities across ${details.size} files, none added`,
);
