import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * No English sentence returned from `src/lib` or `src/db` (docs ADR
 * 20260731-domain-layer-copy-leaks).
 *
 * `scripts/check-copy.mjs` guards `src/app`/`src/components`, where copy shows up as a JSX text
 * node or a copy-attribute literal. Neither pattern exists in the domain, data, or feature-module
 * layers this script guards (`src/lib`, `src/db`, `src/features`) — but a
 * different leak does: a function builds an object with a field named `message` (or a
 * `_LABELS`-suffixed lookup const) whose value is a full English sentence, and a page renders it
 * via `{blocker.message}` — a variable reference, so the JSX scanner never sees it even though the
 * text reaches the screen unlocalized.
 *
 * The architectural rule is: **`src/lib` and `src/db` return codes, `src/app` and
 * `src/components` choose words.** This script is that rule's enforcement — a narrow scan for
 * object-literal properties whose *name* (`message`, `label`, `text`, `reason`, `summary`) marks
 * them as prose, the same discipline `check-copy.mjs` applies to JSX attributes and `.ts`
 * label-map files. It is not a general prose detector: a `reason:` field holding a status code, or
 * an enum-keyed proper-noun table that legitimately belongs in the domain layer (HTTP method
 * names, currency codes), needs an `// i18n-exempt: reason` marker rather than a wider exemption
 * list — narrowing the property list is the fix if this starts false-positiving, not widening the
 * scanned roots.
 *
 * This is a ratchet like `check-copy.mjs`, seeded at zero: `scripts/domain-strings-baseline.json`
 * starts empty because the audit that motivated this script extracted everything it found in the
 * same change. A file with no baseline entry may contain none of this shape at all.
 */

const ROOT = process.cwd();
const BASELINE_PATH = "scripts/domain-strings-baseline.json";
// src/features sits on the lib/db side of the app → features → lib/db dependency direction
// (ADR 20260730-feature-module-contracts), so the codes-not-sentences discipline applies there too.
const guardedRoots = ["src/lib", "src/db", "src/features"];

/**
 * Object-literal properties whose *name* marks them as prose. Deliberately narrow — the same list
 * `check-copy.mjs` uses for its `.ts` label-map scan, so a code shape that leaks past one scanner
 * leaks past both identically. No `title`/`description`: those collide with unrelated config
 * shapes (Stripe metadata, structured-data objects) that are common in `src/lib`/`src/db` and are
 * not prose maps.
 */
const copyProperties = ["message", "label", "text", "reason", "summary"];

/**
 * Key-registry data modules: files whose entire job is to hold message-bundle
 * *keys* and structure (the `src/lib/demo-roles.ts` pattern). These get a
 * stricter rule than the property-name scan above — **no string literal
 * containing prose at all**, because in a registry any multi-word literal is a
 * sentence that bypassed the bundles (the leak that let the feature grid and
 * the switching guides render English to Spanish visitors). A literal that
 * genuinely isn't language — a currency figure, a proper name, a cited
 * document title — carries an `// i18n-exempt: reason` on its own or the
 * preceding line. Not a ratchet: any unexempted hit fails outright.
 */
const proseFreeFiles = [
  "src/lib/marketing.ts",
  "src/lib/migration-guides.ts",
  "src/lib/demo-roles.ts",
];

/** Any quoted or template literal containing whitespace between letter runs — prose-shaped. */
const proseLiteralPattern =
  /"([^"\n]*[A-Za-z]{2}[^"\n]*\s[^"\n]*[A-Za-z]{2}[^"\n]*)"|'([^'\n]*[A-Za-z]{2}[^'\n]*\s[^'\n]*[A-Za-z]{2}[^'\n]*)'|`([^`\n]*[A-Za-z]{2}[^`\n]*\s[^`\n]*[A-Za-z]{2}[^`\n]*)`/g;

const labelMapPropertyPattern = new RegExp(
  `(?:^|[\\s,{])(${copyProperties.join("|")})\\s*:\\s*(?:"([^"]{2,})"|'([^']{2,})'|\`([^\`]{2,})\`)`,
  "gm",
);

/**
 * Exemption markers, anchored to real comment syntax — see `check-copy.mjs` for why this must not
 * match bare prose.
 */
const EXEMPT_LINE = /\/\/[^\n]*\bi18n-exempt:\s*\S/;
const EXEMPT_FILE = /\/\/[^\n]*\bi18n-exempt-file:\s*\S/;

/** Strips comments so their prose never reads as copy — but keeps line count. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + " ".repeat(match.length - lead.length));
}

/**
 * Prose, as opposed to an identifier, a slug, or a symbol. Requires a run of at least two letters
 * and rejects values that look like code, a template placeholder, or a proper-noun abbreviation.
 */
function looksLikeCopy(raw) {
  const value = raw.trim();
  if (value.length < 2) return false;
  if (!/[A-Za-z]{2}/.test(value)) return false;
  if (/(&&|\|\||=>|===|!==|\?\.|\$\{)/.test(value)) return false;
  if (value.includes(";")) return false;
  if (/[a-z]\.[A-Za-z_$][\w$]*/.test(value) && !/[.!?]\s/.test(value)) return false;
  if (/\w\(\s*\)/.test(value)) return false;
  // A lone identifier, an all-caps abbreviation (agency/certifying-body codes), a slug.
  if (/^[a-z0-9_-]+$/i.test(value) && !/\s/.test(value)) return false;
  if (/^[A-Z0-9_-]+$/.test(value)) return false;
  if (/^[./#@]/.test(value)) return false;
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
    else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(relativePath);
    }
  }
  return files;
}

/** Every hard-coded returned string in one file, as `{ line, text }`. */
function findDomainStrings(source) {
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
  for (const match of stripped.matchAll(labelMapPropertyPattern)) {
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (!looksLikeCopy(value)) continue;
    const line = lineAt(match.index);
    if (exemptAt(line)) continue;
    found.push({ line: line + 1, text: `${match[1]}: "${value.trim().slice(0, 60)}"` });
  }
  return found;
}

/** The prose-free rule for key-registry modules — see `proseFreeFiles`. */
function findProseLiterals(source) {
  const stripped = stripComments(source);
  const rawLines = source.split("\n");
  const strippedLines = stripped.split("\n");
  const found = [];
  for (const [index, line] of strippedLines.entries()) {
    for (const match of line.matchAll(proseLiteralPattern)) {
      const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
      if (!looksLikeCopy(value)) continue;
      const exempt =
        EXEMPT_LINE.test(rawLines[index] ?? "") || EXEMPT_LINE.test(rawLines[index - 1] ?? "");
      if (exempt) continue;
      found.push({ line: index + 1, text: `"${value.slice(0, 60)}"` });
    }
  }
  return found;
}

const proseFreeFailures = [];
for (const file of proseFreeFiles) {
  let source;
  try {
    source = await readFile(path.join(ROOT, file), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  // Deliberately no EXEMPT_FILE escape here: a registry can't opt out of
  // being a registry — only individual non-language literals get markers.
  for (const hit of findProseLiterals(source)) {
    proseFreeFailures.push({ file, ...hit });
  }
}

const counts = new Map();
const details = new Map();
for (const root of guardedRoots) {
  for (const file of await walk(root)) {
    const source = await readFile(path.join(ROOT, file), "utf8");
    if (EXEMPT_FILE.test(source)) continue;
    const found = findDomainStrings(source);
    if (found.length > 0) {
      counts.set(file, found.length);
      details.set(file, found);
    }
  }
}

// `--report [pathPrefix]` lists what the scanner sees.
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
  console.log(`\n${shown} hard-coded strings under "${prefix || "src/lib, src/db"}"`);
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
  const grew = [...counts.entries()].filter(
    ([file, count]) => baselineExists && count > (baselineCounts[file] ?? 0),
  );
  const added = [...counts.keys()].filter((file) => baselineExists && !(file in baselineCounts));
  if (grew.length > 0 || added.length > 0) {
    if (!absorbing) {
      console.error(
        "Refusing to write a baseline that grows. The ratchet only turns one way — extract the strings instead:",
      );
      for (const [file, count] of grew) {
        console.error(`- ${file}: ${baselineCounts[file]} → ${count}`);
      }
      for (const file of added) console.error(`- ${file}: new file with ${counts.get(file)}`);
      console.error(
        "If this growth arrived in a merge from a branch that predates the check, `--absorb` records it explicitly.",
      );
      process.exit(1);
    }
    console.warn("Absorbing strings that grew — this must be merged-in work, not new code:");
    for (const [file, count] of grew) {
      console.warn(
        `- ${file}: ${baselineCounts[file]} → ${count} (+${count - baselineCounts[file]})`,
      );
    }
    for (const file of added) console.warn(`- ${file}: new file with ${counts.get(file)}`);
  }
  const next = {
    "//": "English strings returned from src/lib or src/db, per file. Written by `node scripts/check-domain-strings.mjs --write`. This number may only go down — see scripts/check-domain-strings.mjs.",
    ...Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
  await writeFile(path.join(ROOT, BASELINE_PATH), `${JSON.stringify(next, null, 2)}\n`);
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  console.log(
    `domain-strings: baseline written — ${counts.size} files, ${total} strings still to extract`,
  );
  process.exit(0);
}

const violations = [];

for (const hit of proseFreeFailures) {
  violations.push(
    `${hit.file}:${hit.line}: prose literal ${hit.text} in a key-registry module. ` +
      `These files hold message-bundle keys and structure only — move the words into ` +
      `src/i18n/locales/<locale>/diver.json (every locale), or mark a genuine non-language ` +
      `literal with \`// i18n-exempt: reason\`.`,
  );
}

for (const [file, count] of counts) {
  const allowed = baselineCounts[file];
  if (allowed === undefined) {
    const sample = details
      .get(file)
      .slice(0, 5)
      .map((hit) => `\n    ${file}:${hit.line}  ${hit.text}`)
      .join("");
    violations.push(
      `${file}: ${count} returned string${count === 1 ? "" : "s"} in a file with no baseline entry.${sample}`,
    );
    continue;
  }
  if (count > allowed) {
    violations.push(
      `${file}: ${count} returned strings, baseline allows ${allowed}. Return a code instead of raising the number.`,
    );
  }
  if (count < allowed) {
    violations.push(
      `${file}: down to ${count} from ${allowed} — lower the baseline in this change (\`node scripts/check-domain-strings.mjs --write\`).`,
    );
  }
}

for (const file of Object.keys(baselineCounts)) {
  if (!counts.has(file)) {
    violations.push(
      `${file}: fully extracted or gone — remove its baseline entry (\`node scripts/check-domain-strings.mjs --write\`).`,
    );
  }
}

if (violations.length > 0) {
  console.error(`Domain-layer copy violations:\n${violations.map((v) => `- ${v}`).join("\n")}`);
  console.error(
    "src/lib and src/db return codes, not sentences — the caller in src/app/src/components resolves the code into a message-bundle key. See ADR 20260731-domain-layer-copy-leaks and the i18n-copy skill.",
  );
  process.exit(1);
}

const remaining = [...counts.values()].reduce((sum, n) => sum + n, 0);
console.log(
  `domain-strings: no new hard-coded copy — ${remaining} string${remaining === 1 ? "" : "s"} across ${counts.size} files still to extract`,
);
