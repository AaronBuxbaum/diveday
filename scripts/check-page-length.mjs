import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * A route stays thin: no `page.tsx` under `src/app` grows past {@link PAGE_LINE_LIMIT} lines.
 *
 * AGENTS.md says routes in `src/app/` stay thin and `pnpm check:architecture` enforces the
 * dependency *direction*, but nothing measured thinness. The 2026-10-07 audit counted 37 of 83
 * `page.tsx` files over 300 lines and eight over 1,000 — domain logic, Drizzle queries and a
 * dozen local components living in the route file, where the architecture guard cannot see
 * them. A page that size is also one an agent cannot read whole (`scripts/guard-read.mjs`
 * refuses a file over 600 lines without a range), so every edit to it starts blind.
 *
 * ### Why a ratchet rather than a flat gate
 *
 * The same shape as `scripts/check-copy.mjs` and `check-type-ramp.mjs`: the per-file line count
 * of every page already over the limit sits in `scripts/page-length-baseline.json` and may only
 * fall. A page over the limit that is not in the baseline fails; a page in it that grew fails;
 * a page in it that shrank fails until the baseline is lowered in the same change
 * (`--write`), so the number tracks reality instead of drifting into a stale allowlist. A page
 * that drops to the limit or below leaves the baseline for good. `--absorb "<why>"` records a
 * deliberate rise — growth arriving from a merge — and `--report` prints the table.
 *
 * The fix for a red count is never to compress a page's formatting. Move a section into a
 * sibling `_components/` file, a query into `src/db`, a rule into `src/lib`.
 */

const ROOT = process.cwd();
const BASELINE_PATH = "scripts/page-length-baseline.json";
export const PAGE_LINE_LIMIT = 400;
const GUARDED_ROOT = "src/app";

/** Lines as an editor numbers them: a trailing newline does not open another line. */
export function countLines(source) {
  if (source.length === 0) return 0;
  const lines = source.split("\n").length;
  return source.endsWith("\n") ? lines - 1 : lines;
}

/**
 * Compare measured counts against the baseline. Pure, so the test can hold every outcome.
 *
 * @param {Map<string, number>} counts every page's line count, keyed by repo-relative path
 * @param {Record<string, number>} baseline the banked counts of pages over the limit
 * @returns {string[]} one sentence per violation
 */
export function comparePageLengths(counts, baseline, limit = PAGE_LINE_LIMIT) {
  const violations = [];
  for (const [file, lines] of counts) {
    const allowed = baseline[file];
    if (allowed === undefined) {
      if (lines > limit) {
        violations.push(
          `${file}: ${lines} lines, over the ${limit}-line limit. Move a section into _components/, a query into src/db, a rule into src/lib.`,
        );
      }
      continue;
    }
    if (lines > allowed) {
      violations.push(
        `${file}: ${lines} lines, baseline allows ${allowed}. Move what you added out of the route file instead of raising the number.`,
      );
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

/** The baseline a `--write` would produce: every page still over the limit. */
export function nextBaseline(counts, limit = PAGE_LINE_LIMIT) {
  return Object.fromEntries(
    [...counts.entries()]
      .filter(([, lines]) => lines > limit)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** Entries a `--write` would raise or add — refused unless absorbed. */
export function growthAgainst(next, baseline) {
  return Object.entries(next).filter(([file, lines]) => lines > (baseline[file] ?? 0));
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
    else if (entry.name === "page.tsx") files.push(relativePath);
  }
  return files;
}

async function main() {
  const counts = new Map();
  for (const file of await walk(GUARDED_ROOT)) {
    const source = await readFile(path.join(ROOT, file), "utf8");
    counts.set(file.split(path.sep).join("/"), countLines(source));
  }

  if (process.argv.includes("--report")) {
    const over = Object.entries(nextBaseline(counts)).sort(([, a], [, b]) => b - a);
    for (const [file, lines] of over) console.log(`${String(lines).padStart(5)}  ${file}`);
    console.log(`\n${over.length} of ${counts.size} pages over ${PAGE_LINE_LIMIT} lines`);
    process.exit(0);
  }

  let raw = {};
  let baselineExists = true;
  try {
    raw = JSON.parse(await readFile(path.join(ROOT, BASELINE_PATH), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    baselineExists = false;
  }
  const baseline = Object.fromEntries(Object.entries(raw).filter(([key]) => !key.startsWith("//")));

  const absorbIndex = process.argv.indexOf("--absorb");
  const absorbing = absorbIndex !== -1;
  if (process.argv.includes("--write") || absorbing) {
    const next = nextBaseline(counts);
    const grew = baselineExists ? growthAgainst(next, baseline) : [];
    if (grew.length > 0) {
      const reason = process.argv[absorbIndex + 1];
      if (!absorbing || !reason || reason.startsWith("--")) {
        console.error("Refusing to write a baseline that grows. A route only gets thinner:");
        for (const [file, lines] of grew) {
          console.error(`- ${file}: ${baseline[file] ?? `new at ${PAGE_LINE_LIMIT}+`} → ${lines}`);
        }
        console.error(
          'If this growth arrived in a merge, `--absorb "<why>"` records it with its reason.',
        );
        process.exit(1);
      }
      console.warn(`Absorbing page growth (${reason}):`);
      for (const [file, lines] of grew) {
        console.warn(`- ${file}: ${baseline[file] ?? "new"} → ${lines}`);
      }
    }
    const document = {
      "//": `Line counts of the page.tsx files still over ${PAGE_LINE_LIMIT} lines. Written by \`node scripts/check-page-length.mjs --write\`. Each number may only go down — see scripts/check-page-length.mjs.`,
      ...(absorbing && grew.length > 0
        ? { "// absorbed": process.argv[absorbIndex + 1] }
        : raw["// absorbed"]
          ? { "// absorbed": raw["// absorbed"] }
          : {}),
      ...next,
    };
    await writeFile(path.join(ROOT, BASELINE_PATH), `${JSON.stringify(document, null, 2)}\n`);
    const total = Object.keys(next).length;
    console.log(`page-length: baseline written — ${total} pages over ${PAGE_LINE_LIMIT} lines`);
    process.exit(0);
  }

  const violations = comparePageLengths(counts, baseline);
  if (violations.length > 0) {
    console.error(`Page-length violations:\n${violations.map((v) => `- ${v}`).join("\n")}`);
    process.exit(1);
  }
  const over = Object.keys(baseline).length;
  console.log(
    `page-length: no page grew — ${over} of ${counts.size} still over ${PAGE_LINE_LIMIT} lines`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
