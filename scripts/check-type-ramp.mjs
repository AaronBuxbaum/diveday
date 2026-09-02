import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

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
 * `scripts/type-ramp-baseline.json` that may only fall. It lands at zero, so it
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
const BASELINE_PATH = "scripts/type-ramp-baseline.json";
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
  for (const root of guardedRoots) {
    for (const file of await walk(root)) {
      if (file === RAMP_MODULE) continue;
      const found = findRampSpellings(await readFile(path.join(ROOT, file), "utf8"));
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
          "Refusing to write a baseline that grows. The ramp only closes — use a constant from src/components/ui/typography.ts instead:",
        );
        for (const [file, count] of grew) {
          console.error(`- ${file}: ${baselineCounts[file]} → ${count}`);
        }
        for (const file of added) console.error(`- ${file}: new file with ${counts.get(file)}`);
        console.error(
          "If this growth arrived in a merge from a branch that predates the sweep, `--absorb` records it explicitly.",
        );
        process.exit(1);
      }
      console.warn("Absorbing ramp spellings that grew — this must be merged-in work, not new:");
      for (const [file, count] of grew) {
        console.warn(
          `- ${file}: ${baselineCounts[file]} → ${count} (+${count - baselineCounts[file]})`,
        );
      }
      for (const file of added) console.warn(`- ${file}: new file with ${counts.get(file)}`);
    }
    const next = {
      "//": "Bare heading spellings still typed at a call site, per file. Written by `node scripts/check-type-ramp.mjs --write`. This number may only go down — see scripts/check-type-ramp.mjs.",
      ...Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    };
    await writeFile(path.join(ROOT, BASELINE_PATH), `${JSON.stringify(next, null, 2)}\n`);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    console.log(`type-ramp: baseline written — ${counts.size} files, ${total} spellings left`);
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
      "Headings take a named level from src/components/ui/typography.ts — PAGE_TITLE_CLASS, SHELL_TITLE_CLASS, DISPLAY_TITLE_CLASS, BANNER_TITLE_CLASS, LEAD_TITLE_CLASS, SUB_TITLE_CLASS, SECTION_TITLE_CLASS, or one of the four FIGURE_* levels. A genuinely off-ramp heading says `diveday:allow-type-ramp: <why>` on the line or the line above.",
    );
    process.exit(1);
  }

  const remaining = [...counts.values()].reduce((sum, n) => sum + n, 0);
  console.log(
    `type-ramp: the ramp is closed — ${remaining} bare heading spelling${remaining === 1 ? "" : "s"} across ${counts.size} files`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
