import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * No new hard-coded user-facing copy (docs ADR 20260730-staff-copy-localization).
 *
 * `pnpm check:locale` already guarantees that whatever *has* been extracted
 * into a message bundle is translated into every locale. It cannot see the much
 * larger problem: copy that never made it into a bundle at all.
 *
 * This is a **ratchet**, not a hand-authored gate. `copy-baseline.json` records how much
 * un-extracted copy each file still has. The build fails if a file grows, if a
 * file that isn't in the baseline has any at all, or — importantly — if a file
 * *shrinks* without its baseline entry being lowered in the same change. That
 * last rule is what keeps the number honest: the baseline can only ever go
 * down, and it tracks reality rather than drifting into a stale allowlist.
 *
 * The original extraction backlog (once ~1,000 strings across 110 files) is finished:
 * `copy-baseline.json` holds only its `//` note, so the ratchet now behaves as a full gate —
 * any hard-coded copy anywhere under the guarded roots fails the check. Trust the baseline
 * file over any number in prose, here or elsewhere, since prose drifts and the file cannot.
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
 *
 * ## Two remaining blind spots, and how each is closed
 *
 * **`.ts` files under the two UI roots.** JSX text nodes and copy attributes
 * only exist in `.tsx`, so a `.ts` file sitting right next to its component
 * (a `shared.ts` of label maps, a `types.ts` of error messages) was invisible
 * even though it is squarely inside `src/app`/`src/components`. Fixed by
 * `findLabelMapCopy` below: it walks `.ts` files too, but with a narrower
 * pattern than the JSX one — only object-literal properties whose *name*
 * (`message`, `label`, `text`, …) marks them as prose, the same discipline
 * `copyAttributes` already applies to JSX attributes. This caught
 * `divers/[personId]/_components/shared.ts`'s `PAYMENT_STATUS_LABELS` et al.
 * and `trips/[id]/_components/types.ts`'s `ERROR_MESSAGES`
 * (docs ADR 20260731-domain-layer-copy-leaks).
 *
 * **`src/lib`, `src/db`, and `src/features`.** A sentence *returned* from domain, data, or
 * feature-module code is invisible to a scanner rooted at `src/app`/`src/components` — a sibling
 * script, `scripts/check-domain-strings.mjs`, covers this instead of widening this one. See that
 * file for why a separate, narrower tool was the right shape rather than extending this scan's
 * root list: this file stays about JSX-adjacent copy, and it stays sound.
 *
 * The remaining rule is architectural, and it is stronger than either scan:
 * **`src/lib` and `src/db` return codes, `src/app` and `src/components` choose
 * words.** A union of string-literal codes is a compile-time contract, so a
 * page that forgets to translate one is a type error at the lookup map rather
 * than English on screen. That part is a review expectation; see the
 * `i18n-copy` skill.
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
 * Object-literal properties whose *name* marks them as prose — the same
 * discipline `copyAttributes` applies to JSX attributes, but for plain object
 * literals (`{ padi: "PADI", other: "Other agency" }`) in a `.ts` file with no
 * JSX to scan. Deliberately a short, specific list: widen it and this starts
 * catching `variant`/`tone`/`size`-keyed Tailwind-class maps instead.
 *
 * No `title` or `description`: those collide constantly with `export const
 * metadata` (Next resolves it before locale negotiation can run — the same
 * exempt-by-convention carve-out `EXEMPT_FILE` documents) and JSON-LD/OG
 * config objects, which are not prose maps. The JSX attribute list above
 * still catches a real `title=`/`description=` on an element.
 */
const copyProperties = ["message", "label", "text", "reason", "summary"];

const labelMapPropertyPattern = new RegExp(
  `(?:^|[\\s,{])(${copyProperties.join("|")})\\s*:\\s*(?:"([^"]{2,})"|'([^']{2,})'|\`([^\`]{2,})\`)`,
  "gm",
);

/**
 * A JSX text node: text between `>` and `<` holding no braces or tags. Also
 * catches `{"…"}` and `{'…'}`, which is the same copy wearing a disguise.
 */
const textNodePattern = />([^<>{}]+)</g;
const bracedStringPattern = /[>\s]\{\s*(?:"([^"]{2,})"|'([^']{2,})')\s*\}/g;

/**
 * Exemption markers, anchored to real comment syntax.
 *
 * Matching the bare words anywhere in the source would let a plain string —
 * `<p>Write i18n-exempt-file: reason to skip</p>`, or a message in this very
 * repo's docs — switch the whole check off for a file. An escape hatch that can
 * be triggered by prose is not an escape hatch, it is a hole, so both forms
 * must appear as `// …` or `{/* … *\/}`.
 */
const EXEMPT_LINE = /(?:\/\/|\{\s*\/\*)[^\n]*\bi18n-exempt:\s*\S/;
const EXEMPT_FILE = /(?:\/\/|\{\s*\/\*)[^\n]*\bi18n-exempt-file:\s*\S/;

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
  // The tail of a comparison the window opened on. `>=` and `<=` both leave the
  // `=` as the window's first character, so `photos.length >= maxPhotos ? (`
  // arrives here as `= maxPhotos ? (` — an expression, and one the ternary rule
  // below misses because its `:` is past the next `<`.
  if (value.startsWith("=")) return false;
  // A type union. `void | Promise` is what `=> void | Promise<void>` leaves
  // behind, and it reached the report five times from one file of server-action
  // props. A single pipe is already excluded when doubled; a sentence a diver
  // reads does not carry a bare one either.
  if (/\s\|\s/.test(value)) return false;
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
    else if (
      (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx") &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(relativePath);
    }
  }
  return files;
}

/** Every hard-coded user-facing string in one file, as `{ line, text }`. */
function findCopy(source, { isTsx }) {
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

  if (isTsx) {
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
  }
  for (const match of stripped.matchAll(labelMapPropertyPattern)) {
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (looksLikeCopy(value)) record(match.index, `${match[1]}: "${value}"`);
  }
  return found;
}

const counts = new Map();
const details = new Map();
for (const root of guardedRoots) {
  for (const file of await walk(root)) {
    const source = await readFile(path.join(ROOT, file), "utf8");
    if (EXEMPT_FILE.test(source)) continue;
    const found = findCopy(source, { isTsx: file.endsWith(".tsx") });
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

/**
 * `--absorb` is `--write` for one specific situation: merging a branch that was
 * authored before this check existed on it. Copy that landed on `main` in
 * parallel is pre-existing debt from the ratchet's point of view, not new debt
 * — but `--write` cannot tell the two apart, and correctly refuses both.
 *
 * So this exists, and it is deliberately loud rather than convenient: it prints
 * every increase it is about to accept, so the growth appears in the run log
 * and the reviewer sees it in the diff. It is not a way to land new copy. If
 * you are reaching for it and you did not just merge, extract the strings.
 *
 * Expect this to stop being needed once every branch carries the check.
 */
const absorbing = process.argv.includes("--absorb");

if (process.argv.includes("--write") || absorbing) {
  const grew = [...counts.entries()].filter(
    ([file, count]) => baselineExists && count > (baselineCounts[file] ?? 0),
  );
  const added = [...counts.keys()].filter((file) => baselineExists && !(file in baselineCounts));
  if (grew.length > 0 || added.length > 0) {
    if (!absorbing) {
      console.error(
        "Refusing to write a baseline that grows. The ratchet only turns one way — extract the copy instead:",
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
    console.warn("Absorbing copy that grew — this must be merged-in work, not new copy:");
    for (const [file, count] of grew) {
      console.warn(
        `- ${file}: ${baselineCounts[file]} → ${count} (+${count - baselineCounts[file]})`,
      );
    }
    for (const file of added) console.warn(`- ${file}: new file with ${counts.get(file)}`);
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
    "User-facing copy comes from a message bundle: src/i18n/locales/<locale>/diver.json for divers, staff/<namespace>.json for staff. See the i18n-copy skill.",
  );
  process.exit(1);
}

const remaining = [...counts.values()].reduce((sum, n) => sum + n, 0);
console.log(
  `copy: no new hard-coded copy — ${remaining} string${remaining === 1 ? "" : "s"} across ${counts.size} files still to extract`,
);
