import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { filesUnder } from "./files-under.mjs";
import { LARGE_FILE_LINES } from "./guard-read.mjs";
import { bankCounts, ratchetFlags, readCounts } from "./ratchet.mjs";

/**
 * A route stays thin: no `page.tsx` under `src/app` grows past {@link PAGE_LINE_LIMIT} lines, and
 * no top-level function anywhere in the app's source grows past {@link FUNCTION_LINE_LIMIT}.
 *
 * AGENTS.md says routes in `src/app/` stay thin and `pnpm check:architecture` enforces the
 * dependency *direction*, but nothing measured thinness. The 2026-10-07 audit counted 37 of 83
 * `page.tsx` files over 300 lines and eight over 1,000 — domain logic, Drizzle queries and a
 * dozen local components living in the route file, where the architecture guard cannot see
 * them. A page that size is also one an agent cannot read whole (`scripts/guard-read.mjs`
 * refuses a file over {@link FILE_LINE_LIMIT} lines without a range), so every edit to it
 * starts blind.
 *
 * ### Why a ratchet rather than a flat gate
 *
 * The same shape as `scripts/check-copy.mjs` and `check-type-ramp.mjs`: the per-file line count
 * of every page already over the limit sits in `scripts/ratchets.json` (its `page-length` section,
 * read and written through `scripts/ratchet.mjs` like every other ratchet) and may only fall. A page over the limit that is not in the baseline fails; a page in it that grew fails;
 * a page in it that shrank fails until the baseline is lowered in the same change
 * (`--write`), so the number tracks reality instead of drifting into a stale allowlist. A page
 * that drops to the limit or below leaves the baseline for good. `--absorb "<why>"` records a
 * deliberate rise — growth arriving from a merge — and `--report` prints the table.
 *
 * The fix for a red count is never to compress a page's formatting. Move a section into a
 * sibling `_components/` file, a query into `src/db`, a rule into `src/lib`.
 *
 * ### The function half
 *
 * Guarding `page.tsx` alone moved the monolith rather than stopping it: the 2026-10-10 review
 * found the weight had gone into `_components/*.tsx` and `actions.ts`, where the first half of
 * this guard cannot see it — `PrepBody` was one 1,322-line render function, `RosterRow` 1,142,
 * `OfflineManifestView` 1,083, each a safety surface an agent could not read whole. So the same
 * ratchet also counts every top-level function under {@link FUNCTION_ROOTS} (tests excluded)
 * and banks the ones over {@link FUNCTION_LINE_LIMIT} in the `function-length` section, keyed
 * `<file>#<name>`. Same mechanics: a new one over the limit fails, a banked one may only shrink,
 * a shrink is banked with `--write`, and `--absorb "<why>"` records a rise from a merge — all
 * through this file, which runs every half (`main(["functions"])` runs the second alone).
 *
 * A function is measured off the formatter's layout rather than a parse: TypeScript 7 no longer
 * exports a parser to JavaScript (see `scripts/check-db-concurrency.mjs`'s header), and Biome
 * guarantees what the measure leans on — a top-level declaration starts in column 0 and every
 * line inside it is indented, except the lines that close something (`}) {` after a
 * destructured parameter list, the final `}` or `});`). {@link measureFunctions} reads a
 * declaration from its first line to the first column-0 line that only closes. The one shape it
 * misreads is a multi-line template literal whose body starts in column 0, which ends the
 * function early: it can under-count, never over-count, and nothing over the limit does it today.
 *
 * A function is charged for its **code lines** only: blank lines and comment lines (`//`,
 * `/* … *\/` blocks, JSX `{/* … *\/}`) are left out ({@link countCodeLines}). The 2026-10-13
 * review found the line count charging this repository's documentation habit as complexity: of
 * nineteen functions over 400 lines, seven were over in code, `OfflineManifestManager` was a
 * third comment, and one commit rewrapped comments to fit the limit. So the limit is
 * {@link FUNCTION_LINE_LIMIT} code lines, and a comment never costs a split.
 *
 * ### The file half
 *
 * A function-only ratchet is met by splitting inside the file: `CommandPalette.tsx` stayed at
 * 1,017 lines after its one function was brought under the limit, and ten source files under
 * `src/app` and `src/components` stayed over the read guard. So the `file-length` section banks
 * every file under {@link FILE_ROOTS} (and every test file under `src/`) over
 * {@link FILE_LINE_LIMIT} physical lines, the same number `scripts/guard-read.mjs` refuses to
 * hand an agent whole. Same mechanics again: a split moves code into a new file.
 *
 * ### Near the limit
 *
 * A split that stops at the line leaves the next edit to break the ratchet, and the agent who
 * makes that edit pays for the split. Every half prints a warning (not a failure) for an
 * unbanked entry within {@link NEAR_LIMIT_BAND} of its limit, so a session knows before it
 * edits, and a split aims well under: 350 lines for a page, 250 code lines for a function.
 */

const ROOT = process.cwd();
const GUARD = "page-length";
export const PAGE_LINE_LIMIT = 400;
const GUARDED_ROOT = "src/app";

const FUNCTION_GUARD = "function-length";
/** Code lines: blank and comment lines are not counted ({@link countCodeLines}). */
export const FUNCTION_LINE_LIMIT = 300;
export const FUNCTION_ROOTS = ["src/app", "src/components", "src/features", "src/db", "src/lib"];
const SOURCE_FILE = /\.(?:ts|tsx|mjs|js)$/;
const TEST_FILE = /\.test\.(?:ts|tsx|mjs|js)$/;

const FILE_GUARD = "file-length";
/** The read guard's own number: a file over it is never handed to an agent whole. */
export const FILE_LINE_LIMIT = LARGE_FILE_LINES;
/** Source files (tests excluded) measured whole; every test file under {@link TEST_ROOT} too. */
export const FILE_ROOTS = ["src/app", "src/components"];
const TEST_ROOT = "src";

/** An unbanked entry this close to its limit is warned about, never refused. */
export const NEAR_LIMIT_BAND = 20;

/** `function Name(`, with any of `export`, `default`, `async` in front. */
const FUNCTION_DECLARATION =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s*([A-Za-z_$][\w$]*)?\s*[<(]/;
/** `const Name = <initializer>` — the initializer is tested by {@link FUNCTION_INITIALIZER}. */
const BINDING = /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*).*?\s=\s(.*)$/;
/**
 * An initializer that is a function: an arrow, a `function` expression, or one of those handed
 * straight to a wrapper (`cache(async (…) => {`, `memo(function Row(…) {`).
 */
const FUNCTION_INITIALIZER =
  /^(?:[A-Za-z_$][\w$.]*\()?(?:async\s+)?(?:function\b|\(|<[A-Za-z_$]|[A-Za-z_$][\w$]*\s*=>)/;
/** A column-0 line that only closes: `}`, `});`, `})`, `];` — the end of the declaration. */
const TERMINAL_CLOSER = /^[}\])][\s)\]};,]*$/;

/**
 * How many of `lines` are code: not blank, not inside a block comment, not a `//` line, not a
 * JSX `{/* … *\/}` line. Line-based, like the rest of this guard: a comment trailing code on the
 * same line counts as code, and a line that closes a block comment and then carries code counts.
 *
 * @param {string[]} lines
 */
export function countCodeLines(lines) {
  let code = 0;
  let inBlock = false;
  for (const raw of lines) {
    let text = raw.trim();
    if (inBlock) {
      const close = text.indexOf("*/");
      if (close === -1) continue;
      inBlock = false;
      text = text
        .slice(close + 2)
        .replace(/^\}/, "")
        .trim();
    }
    while (text.startsWith("/*") || text.startsWith("{/*")) {
      const open = text.indexOf("/*");
      const close = text.indexOf("*/", open + 2);
      if (close === -1) {
        inBlock = true;
        text = "";
        break;
      }
      text = text
        .slice(close + 2)
        .replace(/^\}/, "")
        .trim();
    }
    if (text.length === 0 || text.startsWith("//")) continue;
    code++;
  }
  return code;
}

/**
 * Every top-level function in a source file, as `{ name, line, lines, code }`: `lines` from its
 * first line to its last, `code` the ones {@link countCodeLines} counts.
 *
 * A declaration ends at the first column-0 line that only closes. A column-0 line that closes
 * and opens (`}: Props) {`) is still the signature; any other column-0 line is the next
 * statement, so a declaration that never reached a closer (`const f = (a) =>` and an indented
 * body) ends on the last non-blank line before it.
 */
export function measureFunctions(source) {
  const lines = source.split("\n");
  const functions = [];
  for (let start = 0; start < lines.length; start++) {
    const text = lines[start];
    let name;
    const declaration = FUNCTION_DECLARATION.exec(text);
    if (declaration) name = declaration[1] ?? "default";
    else {
      const binding = BINDING.exec(text);
      if (!binding || !FUNCTION_INITIALIZER.test(binding[2])) continue;
      name = binding[1];
    }
    let end = start;
    for (let next = start + 1; next < lines.length; next++) {
      const line = lines[next];
      if (line.length === 0 || /^\s/.test(line)) {
        if (line.trim().length > 0) end = next;
        continue;
      }
      if (TERMINAL_CLOSER.test(line)) {
        end = next;
        break;
      }
      if (/^[}\])]/.test(line)) {
        end = next;
        continue;
      }
      break;
    }
    functions.push({
      name,
      line: start + 1,
      lines: end - start + 1,
      code: countCodeLines(lines.slice(start, end + 1)),
    });
    start = end;
  }
  return functions;
}

/**
 * Every function's code lines keyed `<file>#<name>`; a name declared twice keeps its longest.
 */
export function functionCounts(files) {
  const counts = new Map();
  for (const [file, source] of files) {
    for (const { name, code } of measureFunctions(source)) {
      const key = `${file}#${name}`;
      counts.set(key, Math.max(counts.get(key) ?? 0, code));
    }
  }
  return counts;
}

/** Lines as an editor numbers them: a trailing newline does not open another line. */
export function countLines(source) {
  if (source.length === 0) return 0;
  const lines = source.split("\n").length;
  return source.endsWith("\n") ? lines - 1 : lines;
}

const PAGE_ADVICE = {
  over: "Move a section into _components/, a query into src/db, a rule into src/lib.",
  grew: "Move what you added out of the route file instead of raising the number.",
};
const FUNCTION_ADVICE = {
  over: "Split it along its sections into named functions or sibling components.",
  grew: "Move what you added into a function of its own instead of raising the number.",
};
const FILE_ADVICE = {
  over: "Move a component, a group of helpers or a describe block into a sibling file.",
  grew: "Put what you added in a sibling file (a new test file for new tests) instead of raising the number.",
};

/**
 * Compare measured counts against the baseline. Pure, so the test can hold every outcome.
 *
 * @param {Map<string, number>} counts every page's (or function's) line count, keyed by path
 * @param {Record<string, number>} baseline the banked counts of entries over the limit
 * @returns {string[]} one sentence per violation
 */
export function comparePageLengths(
  counts,
  baseline,
  limit = PAGE_LINE_LIMIT,
  advice = PAGE_ADVICE,
) {
  const violations = [];
  for (const [file, lines] of counts) {
    const allowed = baseline[file];
    if (allowed === undefined) {
      if (lines > limit) {
        violations.push(`${file}: ${lines} lines, over the ${limit}-line limit. ${advice.over}`);
      }
      continue;
    }
    if (lines > allowed) {
      violations.push(`${file}: ${lines} lines, baseline allows ${allowed}. ${advice.grew}`);
    } else if (lines < allowed) {
      violations.push(
        `${file}: down to ${lines} from ${allowed} — bank it in this change (\`node scripts/check-page-length.mjs --write\`).`,
      );
    }
  }
  for (const file of Object.keys(baseline)) {
    if (!counts.has(file)) {
      violations.push(
        `${file}: gone — remove its baseline entry (\`node scripts/check-page-length.mjs --write\`).`,
      );
    }
  }
  return violations;
}

/** {@link comparePageLengths} for the function half: its limit and its advice. */
export function compareFunctionLengths(counts, baseline, limit = FUNCTION_LINE_LIMIT) {
  return comparePageLengths(counts, baseline, limit, FUNCTION_ADVICE);
}

/** {@link comparePageLengths} for the file half: its limit and its advice. */
export function compareFileLengths(counts, baseline, limit = FILE_LINE_LIMIT) {
  return comparePageLengths(counts, baseline, limit, FILE_ADVICE);
}

/**
 * Unbanked entries within {@link NEAR_LIMIT_BAND} of the limit, longest first, as warnings.
 * They pass; the warning tells the next session to split before it adds, not after.
 */
export function nearLimit(counts, baseline, limit, band = NEAR_LIMIT_BAND) {
  return [...counts.entries()]
    .filter(([key, lines]) => baseline[key] === undefined && lines <= limit && lines > limit - band)
    .sort(([, a], [, b]) => b - a)
    .map(([key, lines]) => `${key}: ${lines} of ${limit} — split it before you add to it.`);
}

/** The baseline a `--write` would produce: every page still over the limit. */
export function nextBaseline(counts, limit = PAGE_LINE_LIMIT) {
  return Object.fromEntries(
    [...counts.entries()]
      .filter(([, lines]) => lines > limit)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

const listDirectory = (relativeDirectory) =>
  readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true });

async function walk(relativeDirectory, wanted = (name) => name === "page.tsx") {
  return filesUnder(relativeDirectory, listDirectory, (_relativePath, entry) => wanted(entry.name));
}

const posix = (file) => file.split(path.sep).join("/");

async function measurePages() {
  const counts = new Map();
  for (const file of await walk(GUARDED_ROOT)) {
    counts.set(posix(file), countLines(await readFile(path.join(ROOT, file), "utf8")));
  }
  return counts;
}

async function measureFiles() {
  const source = (name) => SOURCE_FILE.test(name) && !TEST_FILE.test(name);
  const files = [];
  for (const root of FILE_ROOTS) files.push(...(await walk(root, source)));
  files.push(...(await walk(TEST_ROOT, (name) => TEST_FILE.test(name))));
  const counts = new Map();
  for (const file of files) {
    counts.set(posix(file), countLines(await readFile(path.join(ROOT, file), "utf8")));
  }
  return counts;
}

async function measureFunctionsInRoots() {
  const files = [];
  for (const root of FUNCTION_ROOTS) {
    const wanted = (name) => SOURCE_FILE.test(name) && !TEST_FILE.test(name);
    for (const file of await walk(root, wanted)) {
      files.push([posix(file), await readFile(path.join(ROOT, file), "utf8")]);
    }
  }
  return functionCounts(files);
}

const HALVES = {
  pages: {
    guard: GUARD,
    limit: PAGE_LINE_LIMIT,
    measure: measurePages,
    compare: comparePageLengths,
    note: `Line counts of the page.tsx files still over ${PAGE_LINE_LIMIT} lines. Written by \`node scripts/check-page-length.mjs --write\`. Each number may only go down — see scripts/check-page-length.mjs.`,
    refusal: "A route only gets thinner — move a section into _components/, a query into src/db",
    noun: "pages",
  },
  functions: {
    guard: FUNCTION_GUARD,
    limit: FUNCTION_LINE_LIMIT,
    measure: measureFunctionsInRoots,
    compare: compareFunctionLengths,
    note: `Code lines (blank and comment lines left out) of the top-level functions under ${FUNCTION_ROOTS.join(", ")} still over ${FUNCTION_LINE_LIMIT}, keyed <file>#<name>. Written by \`node scripts/check-page-length.mjs --write\`. Each number may only go down — see scripts/check-page-length.mjs.`,
    refusal:
      'A function only gets shorter — split it along its sections (a rise from a merge is absorbed with `node scripts/check-page-length.mjs --absorb "<why>"`, which banks every half)',
    noun: "functions",
    unit: "code lines",
  },
  files: {
    guard: FILE_GUARD,
    limit: FILE_LINE_LIMIT,
    measure: measureFiles,
    compare: compareFileLengths,
    note: `Line counts of the files under ${FILE_ROOTS.join(", ")} and the test files under ${TEST_ROOT} still over ${FILE_LINE_LIMIT} lines, the size scripts/guard-read.mjs refuses to read whole. Written by \`node scripts/check-page-length.mjs --write\`. Each number may only go down — see scripts/check-page-length.mjs.`,
    refusal:
      'A file only gets shorter — move code into a sibling file (a rise from a merge is absorbed with `node scripts/check-page-length.mjs --absorb "<why>"`, which banks every half)',
    noun: "files",
  },
};

/** One half of the guard: report, bank, or check. Returns the exit code. */
async function runHalf(half) {
  const counts = await half.measure();
  if (process.argv.includes("--report")) {
    const over = Object.entries(nextBaseline(counts, half.limit)).sort(([, a], [, b]) => b - a);
    for (const [key, lines] of over) console.log(`${String(lines).padStart(5)}  ${key}`);
    console.log(
      `\n${over.length} of ${counts.size} ${half.noun} over ${half.limit} ${half.unit ?? "lines"}\n`,
    );
    return 0;
  }

  const { counts: baseline, exists } = await readCounts(ROOT, half.guard);
  const { write, absorb } = ratchetFlags();
  if (write || absorb !== null) {
    return bankCounts({
      root: ROOT,
      guard: half.guard,
      script: "check-page-length",
      counts: nextBaseline(counts, half.limit),
      allowed: baseline,
      exists,
      note: half.note,
      refusal: half.refusal,
      absorb,
      summary: (entries) => `${entries} ${half.noun} over ${half.limit} ${half.unit ?? "lines"}`,
    });
  }

  const violations = half.compare(counts, baseline);
  if (violations.length > 0) {
    console.error(`${half.guard} violations:\n${violations.map((v) => `- ${v}`).join("\n")}`);
    return 1;
  }
  const near = nearLimit(counts, baseline, half.limit);
  if (near.length > 0) {
    console.warn(`${half.guard}: near the limit\n${near.map((n) => `- ${n}`).join("\n")}`);
  }
  const over = Object.keys(baseline).length;
  console.log(
    `${half.guard}: nothing grew — ${over} of ${counts.size} ${half.noun} still over ${half.limit} ${half.unit ?? "lines"}`,
  );
  return 0;
}

/** Runs the named halves in order and exits non-zero when any of them failed. */
export async function main(halves = ["pages", "functions", "files"]) {
  let code = 0;
  for (const name of halves) code = Math.max(code, await runHalf(HALVES[name]));
  process.exit(code);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
