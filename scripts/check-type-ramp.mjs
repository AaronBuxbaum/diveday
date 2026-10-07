import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { bankCounts, ratchetFlags, readCounts } from "./ratchet.mjs";

/**
 * The heading ramp stays closed (ADR 20260827-clearwater-surface-language,
 * decision 3; `src/components/ui/typography.ts`).
 *
 * Decision 3 closed the ramp to seven levels. A grep on 2026-09-01 found
 * **fourteen heading spellings** still typed at call sites — `text-lg
 * font-semibold` 62 times, `text-3xl font-semibold` 27, and twelve more from 17
 * uses down to one. Two named constants existed (`SHELL_TITLE_CLASS`,
 * `SectionCard`'s private `TITLE_CLASS`); every other heading in the app chose
 * its own size, which is exactly how `text-xl` and `text-2xl` section headings
 * drifted in beside the `text-lg` the ramp names.
 *
 * The sweep that closed it moved ~160 call sites onto the constants. This
 * refuses the reopening — a *bare* ramp spelling (a `text-{lg…4xl}` beside a
 * `font-{semibold,bold}`) anywhere under `src/app` or `src/components`.
 *
 * ### Why a ratchet rather than a flat gate
 *
 * The same shape as `scripts/check-copy.mjs`: a per-file count in
 * `scripts/ratchets.json` (its `type-ramp` section) that may only fall. It lands at zero, so it
 * behaves as a full gate today — but a merge from a branch cut before the sweep
 * will carry spellings that are pre-existing debt rather than new drift, and
 * `--absorb` is how that gets recorded loudly instead of silently. `--write`
 * banks a fall and refuses a rise; `--report [prefix]` prints what it sees.
 *
 * ### What it does not look at
 *
 * A `text-base font-semibold` (the ADR's row title, and `SectionCard`'s `h3`),
 * the eyebrow and the group label, which are already single-spelling constants,
 * and `sm:`/`lg:` responsive bumps — a call site pairs the ramp constant with
 * its own breakpoint step, which is where that decision belongs. Tests are
 * skipped: `ThreadShell.test.tsx` pins `SHELL_TITLE_CLASS`'s literal value on
 * purpose, and that assertion is the opposite of drift.
 */

const ROOT = process.cwd();
export const guardedRoots = ["src/app", "src/components"];

/**
 * The module that owns the ramp, and the only file allowed to spell a level.
 * Anything else naming one of these strings is a call site that opted out.
 */
const RAMP_MODULE = path.join("src", "components", "ui", "typography.ts");

/**
 * A heading spelling: a ramp-sized `text-*` with a heading weight, in either
 * order and with anything Tailwind-ish between them, so
 * `text-3xl tracking-tight font-semibold` cannot slip past a fixed order.
 *
 * A `sm:`/`dark:`/`group-hover:` prefix is not a bare spelling: a call site pairs
 * a ramp constant with its own breakpoint step (`${BANNER_TITLE_CLASS} sm:text-4xl`),
 * which is where that decision belongs.
 *
 * Bounded to a short run of classes between the two so this does not match a
 * `text-lg` at the top of a long `className` and a `font-bold` at the bottom of
 * it, which are two different elements' worth of intent away from each other.
 */
const RAMP_PATTERN =
  /(?<![-:\w])(?:text-(?:lg|xl|2xl|3xl|4xl)(?:[^"'`\n]{0,40}?(?<![-:\w])font-(?:semibold|bold))|font-(?:semibold|bold)(?:[^"'`\n]{0,40}?(?<![-:\w])text-(?:lg|xl|2xl|3xl|4xl)))\b/g;

/**
 * One line may say "this spelling is deliberate, and here is why" — the same
 * shape `check:e2e-hygiene` and the destructive-migration guard use. It is
 * meant for the rare heading that genuinely is not on the ramp (a rendered
 * email, an `ImageResponse` card that Tailwind never reaches).
 */
const ALLOW_PATTERN = /diveday:allow-type-ramp:/;

export function findRampSpellings(source) {
  const lines = source.split("\n");
  const found = [];
  for (const [index, line] of lines.entries()) {
    if (ALLOW_PATTERN.test(line)) continue;
    if (index > 0 && ALLOW_PATTERN.test(lines[index - 1])) continue;
    RAMP_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(RAMP_PATTERN)) {
      found.push({ line: index + 1, text: match[0] });
    }
  }
  return found;
}

/**
 * **One section rung (#1966).** A page's sections once came in two sizes: a
 * `SectionCard` drew its own `h2` at 24px (`LEAD_TITLE_CLASS`) while most
 * hand-spelled section headings wore `SECTION_TITLE_CLASS` at 18px, and the
 * ratchet above could not see it, because both were named constants. Now both
 * read `SECTION_TITLE_CLASS`, and two spellings would reopen the split:
 *
 * - `LEAD_TITLE_CLASS` anywhere under `src/app/shop` — it is the reading
 *   ramp's lead, the same size today but a different rung, and a staff section
 *   that takes it drifts the moment either moves;
 * - an `<h2>` wearing `ITEM_TITLE_CLASS` anywhere — that rung names a thing
 *   inside a section, and a section heading at it is the 18px heading again.
 *
 * A flat gate rather than a ratchet: it lands at zero.
 */
const ITEM_ON_H2 = /<h2\b[^>]*\bITEM_TITLE_CLASS\b/g;
const LEAD_USE = /\bLEAD_TITLE_CLASS\b/g;

export function findSectionRungDrift(file, source) {
  const found = [];
  const lineOf = (offset) => source.slice(0, offset).split("\n").length;
  ITEM_ON_H2.lastIndex = 0;
  for (const match of source.matchAll(ITEM_ON_H2)) {
    found.push({
      line: lineOf(match.index),
      text: "an <h2> at ITEM_TITLE_CLASS — a section heading takes SECTION_TITLE_CLASS",
    });
  }
  const staff = file.split(path.sep).join("/").startsWith("src/app/shop/");
  if (staff) {
    const lines = source.split("\n");
    for (const [index, line] of lines.entries()) {
      if (/^\s*(import\b|[A-Z_]+,\s*$|\}\s*from\b)/.test(line)) continue;
      if (/^\s*(\*|\/\/|\{\/\*)/.test(line)) continue;
      LEAD_USE.lastIndex = 0;
      if (LEAD_USE.test(line)) {
        found.push({
          line: index + 1,
          text: "LEAD_TITLE_CLASS on a staff page — a section heading takes SECTION_TITLE_CLASS",
        });
      }
    }
  }
  return found;
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

async function main() {
  const counts = new Map();
  const details = new Map();
  const rungDrift = [];
  for (const root of guardedRoots) {
    for (const file of await walk(root)) {
      if (file === RAMP_MODULE) continue;
      const source = await readFile(path.join(ROOT, file), "utf8");
      for (const hit of findSectionRungDrift(file, source)) {
        rungDrift.push(`${file}:${hit.line}  ${hit.text}`);
      }
      const found = findRampSpellings(source);
      if (found.length > 0) {
        counts.set(file, found.length);
        details.set(file, found);
      }
    }
  }

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
    console.log(`\n${shown} bare ramp spellings under "${prefix || "src"}"`);
    process.exit(0);
  }

  const { counts: baselineCounts, exists: baselineExists } = await readCounts(ROOT, "type-ramp");
  const { write, absorb } = ratchetFlags();
  if (write || absorb !== null) {
    process.exit(
      await bankCounts({
        root: ROOT,
        guard: "type-ramp",
        counts: counts,
        allowed: baselineCounts,
        exists: baselineExists,
        note: "Bare heading spellings still typed at a call site, per file. Written by `node scripts/check-type-ramp.mjs --write`. This number may only go down — see scripts/check-type-ramp.mjs.",
        refusal:
          "The ramp only closes — use a constant from src/components/ui/typography.ts instead",
        absorb,
        summary: (files, total) => `${files} files, ${total} spellings left`,
      }),
    );
  }

  const violations = [...rungDrift];
  for (const [file, count] of counts) {
    const allowed = baselineCounts[file];
    if (allowed === undefined) {
      const sample = details
        .get(file)
        .slice(0, 5)
        .map((hit) => `\n    ${file}:${hit.line}  ${hit.text}`)
        .join("");
      violations.push(
        `${file}: ${count} bare heading spelling${count === 1 ? "" : "s"} in a file with no baseline entry.${sample}`,
      );
      continue;
    }
    if (count > allowed) {
      violations.push(
        `${file}: ${count} bare heading spellings, baseline allows ${allowed}. Take the level's constant instead of raising the number.`,
      );
    }
    if (count < allowed) {
      violations.push(
        `${file}: down to ${count} from ${allowed} — lower the baseline in this change (\`node scripts/check-type-ramp.mjs --write\`).`,
      );
    }
  }
  for (const file of Object.keys(baselineCounts)) {
    if (!counts.has(file)) {
      violations.push(
        `${file}: fully swept or gone — remove its baseline entry (\`node scripts/check-type-ramp.mjs --write\`).`,
      );
    }
  }

  if (violations.length > 0) {
    console.error(`Type-ramp violations:\n${violations.map((v) => `- ${v}`).join("\n")}`);
    console.error(
      "Headings take a named level from src/components/ui/typography.ts — PAGE_TITLE_CLASS, SHELL_TITLE_CLASS, DISPLAY_TITLE_CLASS, BANNER_TITLE_CLASS, LEAD_TITLE_CLASS, SUB_TITLE_CLASS, SECTION_TITLE_CLASS, ITEM_TITLE_CLASS, or one of the four FIGURE_* levels. A genuinely off-ramp heading says `diveday:allow-type-ramp: <why>` on the line or the line above.",
    );
    process.exit(1);
  }

  const remaining = [...counts.values()].reduce((sum, n) => sum + n, 0);
  console.log(
    `type-ramp: the ramp is closed — ${remaining} bare heading spelling${remaining === 1 ? "" : "s"} across ${counts.size} files`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
