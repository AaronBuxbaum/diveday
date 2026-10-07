import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { physicalUtilitiesInTree, staleBaselineEntries } from "./logical-properties-lib.mjs";
import { bankCounts, ratchetFlags, readCounts } from "./ratchet.mjs";

/**
 * **Layout that does not care which way the page reads.**
 *
 * `src/components` alone carries ~190 logical directional utilities — `ms-`,
 * `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`, `text-end` — against a
 * few dozen physical ones. Somebody has been writing direction-agnostic layout
 * for a long time, and nothing protected it: `check:tokens` guards colour,
 * Biome's `timezone` rule guards time, and this was a convention held in the heads of
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
 * Its section of `scripts/ratchets.json` records how many physical utilities a
 * file still carries. A file not in the baseline may have none, a count may
 * never rise, and a fall must be banked in the same change (`--write`, which
 * refuses to raise anything; `--absorb` records growth arriving from a merge).
 * The grandfathered ones are left alone deliberately: several are legitimate —
 * a decorative offset, a print rule — and a bulk rewrite is churn with no
 * user-visible effect.
 */

const ROOT = process.cwd();
const guardedRoots = ["src/app", "src/components", "src/features"];

/**
 * The scan itself — the walk, and what counts as a physical utility — is
 * `scripts/logical-properties-lib.mjs`, so the vanished-file path below can be
 * tested without a tree on disk and without importing this file (issue #1763).
 * What is left here is the argv, the baseline, the ratchet and the printing.
 *
 * `vanished` is the files the walk listed and the read could not find. It is
 * named below rather than thrown, and kept out of both the baseline write and
 * the stale sweep.
 */
const { details, vanished } = await physicalUtilitiesInTree(
  guardedRoots,
  (directory) => readdir(path.join(ROOT, directory), { withFileTypes: true }),
  (file) => readFile(path.join(ROOT, file), "utf8"),
);

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

if (vanished.length > 0) {
  console.warn(
    `logical-properties: skipped ${vanished.length} file(s) that disappeared between the walk and the read — ${vanished.join(", ")}.\n` +
      "    Nothing is wrong with them: a concurrent edit, rename or delete landed mid-run. Re-run the guard on a settled tree\n" +
      "    (`node scripts/check-logical-properties.mjs`) to have them counted.",
  );
}

const { counts: baselineCounts, exists: baselineExists } = await readCounts(
  ROOT,
  "logical-properties",
);
const { write, absorb } = ratchetFlags();
if (write || absorb !== null) {
  // A baseline written from a scan that missed a file banks a fall that never
  // happened, and the ratchet does not turn back.
  if (vanished.length > 0) {
    console.error(
      `Refusing to write a baseline from an incomplete scan: ${vanished.length} file(s) disappeared mid-run (above). Re-run on a settled tree.`,
    );
    process.exit(1);
  }
  process.exit(
    await bankCounts({
      root: ROOT,
      guard: "logical-properties",
      counts: details,
      allowed: baselineCounts,
      exists: baselineExists,
      note: "Physical directional utilities still in components, per file. Written by `node scripts/check-logical-properties.mjs --write`. This number may only go down — see scripts/check-logical-properties.mjs. Use ms-/me-/ps-/pe-/start-/end-/text-start/text-end instead.",
      refusal: "The ratchet only turns one way — use the logical utility instead",
      absorb,
      summary: (files, total) => `${files} files, ${total} utilities`,
    }),
  );
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
for (const file of staleBaselineEntries(baselineCounts, { details, vanished })) {
  violations.push(
    `${file}: clean or gone — remove its baseline entry (\`node scripts/check-logical-properties.mjs --write\`).`,
  );
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
