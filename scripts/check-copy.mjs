import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * No new hard-coded user-facing copy (docs ADR 20260730-staff-copy-localization).
 *
 * `pnpm check:locale` already guarantees that whatever *has* been extracted
 * into a message bundle is translated into every locale. It cannot see the much
 * larger problem: copy that never made it into a bundle at all. Roughly 700
 * English strings are still compiled into `src/app` and `src/components`, and
 * extracting them is a long mechanical job. Blocking on finishing it would mean
 * either never landing the rule or landing a rule nobody can satisfy.
 *
 * So this is a **ratchet**, not a gate. `copy-baseline.json` records how much
 * un-extracted copy each file still has. The build fails if a file grows, if a
 * file that isn't in the baseline has any at all, or — importantly — if a file
 * *shrinks* without its baseline entry being lowered in the same change. That
 * last rule is what keeps the number honest: the baseline can only ever go
 * down, and it tracks reality rather than drifting into a stale allowlist.
 *
 * What counts as user-facing copy:
 *   - a JSX text node (`<p>Book now</p>`)
 *   - a string literal in an attribute whose whole purpose is to be read by a
 *     human or a screen reader (`placeholder`, `aria-label`, `alt`, `title`, …)
 *
 * What does not, and why:
 *   - `className`, `href`, `id`, test ids, enum-ish values — string literals,
 *     but not prose.
 *   - Anything marked `{/* i18n-exempt: why *\/}` on the line or the line
 *     above, or a whole file marked `// i18n-exempt-file: why`. Both require a
 *     reason, so an exemption is reviewable rather than invisible.
 *   - Static `metadata.title` exports, which Next resolves before locale
 *     negotiation can run (the same carve-out ADR 20260729 documents).
 *
 * This is a heuristic over source text, not a TypeScript parse. It is tuned to
 * under-report rather than over-report: a missed string is a gap the baseline
 * will surface later, whereas a false positive blocks unrelated work.
 */

const ROOT = process.cwd();
const BASELINE_PATH = "scripts/copy-baseline.json";
const guardedRoots = ["src/app", "src/components"];

/** Attributes that exist to be read by a person or announced by a screen reader. */
const copyAttributes = [
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "confirmMessage",
  "description",
  "eyebrow",
  "heading",
  "label",
  "pendingLabel",
  "placeholder",
  "title",
];

const attributePattern = new RegExp(
  `(?:^|[\\s{])(${copyAttributes.join("|")})=(?:"([^"]*)"|'([^']*)'|\\{\\s*"([^"]*)"\\s*\\})`,
  "g",
);

/**
 * A JSX text node: text between `>` and `<` holding no braces or tags. Also
 * catches `{"…"}` and `{'…'}`, which is the same copy wearing a disguise.
 */
const textNodePattern = />([^<>{}]+)</g;
const bracedStringPattern = /[>\s]\{\s*(?:"([^"]{2,})"|'([^']{2,})')\s*\}/g;

const EXEMPT_LINE = /i18n-exempt:\s*\S/;
const EXEMPT_FILE = /i18n-exempt-file:\s*\S/;

/** Strips comments so their prose never reads as copy — but keeps line count. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + " ".repeat(match.length - lead.length));
}

/**
 * Prose, as opposed to an identifier, a slug, or a symbol. Requires a run of at
 * least two letters and rejects values that look like code or markup leftovers.
 */
function looksLikeCopy(raw) {
  const value = raw.trim();
  if (value.length < 2) return false;
  if (!/[A-Za-z]{2}/.test(value)) return false;
  // Operators and JSX/TS syntax that a `>…<` window can straddle — the window
  // spans from a generic's closing bracket or a comparison to the next tag, so
  // it routinely catches type annotations and expressions.
  if (/(&&|\|\||=>|===|!==|\?\.|\$\{)/.test(value)) return false;
  if (value.includes(";")) return false;
  // A ternary: `cond ? a : b`.
  if (/\s\?\s/.test(value) && /\s:\s/.test(value)) return false;
  // Property access or a call — `trip.waiverComplete`, `foo()`.
  if (/[a-z]\.[A-Za-z_$][\w$]*/.test(value) && !/[.!?]\s/.test(value)) return false;
  if (/\w\(\s*\)/.test(value)) return false;
  // A bare `name: Type` annotation left over from a generic.
  if (/^\s*\w+\s*:\s*[A-Z]\w*\s*$/.test(value)) return false;
  // A lone identifier, a slug, a path, a class list, a bare HTML entity.
  if (/^[a-z0-9_-]+$/i.test(value) && !/\s/.test(value)) return false;
  if (/^[./#@]/.test(value)) return false;
  if (/^&[a-z]+;$/i.test(value)) return false;
  return true;
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
    else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) {
      files.push(relativePath);
    }
  }
  return files;
}

/** Every hard-coded user-facing string in one file, as `{ line, text }`. */
function findCopy(source) {
  const stripped = stripComments(source);
  const rawLines = source.split("\n");
  const lineStarts = [];
  let offset = 0;
  for (const line of stripped.split("\n")) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const lineAt = (index) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (lineStarts[mid] <= index) low = mid;
      else high = mid - 1;
    }
    return low;
  };

  const exemptAt = (line) =>
    EXEMPT_LINE.test(rawLines[line] ?? "") || EXEMPT_LINE.test(rawLines[line - 1] ?? "");

  const found = [];
  const record = (index, text) => {
    const line = lineAt(index);
    if (exemptAt(line)) return;
    found.push({ line: line + 1, text: text.trim().slice(0, 60) });
  };

  for (const match of stripped.matchAll(textNodePattern)) {
    if (looksLikeCopy(match[1])) record(match.index + 1, match[1]);
  }
  for (const match of stripped.matchAll(bracedStringPattern)) {
    const value = match[1] ?? match[2] ?? "";
    if (looksLikeCopy(value)) record(match.index, value);
  }
  for (const match of stripped.matchAll(attributePattern)) {
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (looksLikeCopy(value)) record(match.index, `${match[1]}="${value}"`);
  }
  return found;
}

const counts = new Map();
const details = new Map();
for (const root of guardedRoots) {
  for (const file of await walk(root)) {
    const source = await readFile(path.join(ROOT, file), "utf8");
    if (EXEMPT_FILE.test(source)) continue;
    const found = findCopy(source);
    if (found.length > 0) {
      counts.set(file, found.length);
      details.set(file, found);
    }
  }
}

// `--report [pathPrefix]` lists what the scanner sees, which is how you work
// through a file when extracting its copy.
const reportIndex = process.argv.indexOf("--report");
if (reportIndex !== -1) {
  const prefix = process.argv[reportIndex + 1] ?? "";
  let shown = 0;
  for (const [file, hits] of [...details.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!file.startsWith(prefix)) continue;
    console.log(`\n${file} (${hits.length})`);
    for (const hit of hits) console.log(`  ${hit.line}\t${hit.text}`);
    shown += hits.length;
  }
  console.log(`\n${shown} hard-coded strings under "${prefix || "src"}"`);
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
// The file carries a leading note for humans; it is not a path.
const baselineCounts = Object.fromEntries(
  Object.entries(baseline).filter(([key]) => !key.startsWith("//")),
);

if (process.argv.includes("--write")) {
  const grew = [...counts.entries()].filter(
    ([file, count]) => baselineExists && count > (baselineCounts[file] ?? 0),
  );
  const added = [...counts.keys()].filter((file) => baselineExists && !(file in baselineCounts));
  if (grew.length > 0 || added.length > 0) {
    console.error(
      "Refusing to write a baseline that grows. The ratchet only turns one way — extract the copy instead:",
    );
    for (const [file, count] of grew) {
      console.error(`- ${file}: ${baselineCounts[file]} → ${count}`);
    }
    for (const file of added) console.error(`- ${file}: new file with ${counts.get(file)}`);
    process.exit(1);
  }
  const next = {
    "//": "Hard-coded user-facing strings still awaiting extraction, per file. Written by `node scripts/check-copy.mjs --write`. This number may only go down — see scripts/check-copy.mjs.",
    ...Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
  await writeFile(path.join(ROOT, BASELINE_PATH), `${JSON.stringify(next, null, 2)}\n`);
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  console.log(`copy: baseline written — ${counts.size} files, ${total} strings still to extract`);
  process.exit(0);
}

const violations = [];

for (const [file, count] of counts) {
  const allowed = baselineCounts[file];
  if (allowed === undefined) {
    const sample = details
      .get(file)
      .slice(0, 5)
      .map((hit) => `\n    ${file}:${hit.line}  ${hit.text}`)
      .join("");
    violations.push(
      `${file}: ${count} hard-coded user-facing string${count === 1 ? "" : "s"} in a file with no baseline entry.${sample}`,
    );
    continue;
  }
  if (count > allowed) {
    violations.push(
      `${file}: ${count} hard-coded strings, baseline allows ${allowed}. Extract the new copy instead of raising the number.`,
    );
  }
  if (count < allowed) {
    violations.push(
      `${file}: down to ${count} from ${allowed} — lower the baseline in this change (\`node scripts/check-copy.mjs --write\`).`,
    );
  }
}

for (const file of Object.keys(baselineCounts)) {
  if (!counts.has(file)) {
    violations.push(
      `${file}: fully extracted or gone — remove its baseline entry (\`node scripts/check-copy.mjs --write\`).`,
    );
  }
}

if (violations.length > 0) {
  console.error(`Hard-coded copy violations:\n${violations.map((v) => `- ${v}`).join("\n")}`);
  console.error(
    "User-facing copy comes from a message bundle: src/i18n/locales/<locale>/diver.json for divers, staff.json for staff. See the i18n-copy skill.",
  );
  process.exit(1);
}

const remaining = [...counts.values()].reduce((sum, n) => sum + n, 0);
console.log(
  `copy: no new hard-coded copy — ${remaining} string${remaining === 1 ? "" : "s"} across ${counts.size} files still to extract`,
);
