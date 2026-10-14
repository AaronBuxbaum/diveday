#!/usr/bin/env tsx
/**
 * How much of each dive area the catalog defines: `pnpm content:coverage`.
 *
 * Reads every denominator in `src/content/coverage/` and prints, per area,
 * the sites counted, the sites a template defines, the share, and whether the
 * area is promised. `--missing` lists the undefined sites under each area,
 * which is the work list for the **expand-content** skill.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { COVERAGE_PROMISE, type CoverageDenominator, coverageOf } from "../src/content/coverage";

const dir = path.join(process.cwd(), "src", "content", "coverage");
const showMissing = process.argv.includes("--missing");
const rows = readdirSync(dir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as CoverageDenominator)
  .sort((a, b) => a.area.localeCompare(b.area));

let counted = 0;
let defined = 0;
for (const denominator of rows) {
  const coverage = coverageOf(denominator);
  counted += coverage.counted;
  defined += coverage.defined;
  const share = `${Math.round(coverage.share * 100)}%`.padStart(4);
  const flag = denominator.promised
    ? coverage.share >= COVERAGE_PROMISE
      ? "promised"
      : "PROMISED, BELOW"
    : "not yet promised";
  console.log(
    `${denominator.area.padEnd(30)} ${String(coverage.defined).padStart(4)} / ${String(coverage.counted).padEnd(4)} ${share}  ${flag}`,
  );
  if (showMissing) for (const name of coverage.missing) console.log(`    - ${name}`);
}
if (rows.length) {
  console.log(`${"all areas".padEnd(30)} ${String(defined).padStart(4)} / ${counted}`);
} else {
  console.log("No denominators yet: an area gets one through the expand-content skill.");
}

// The species half: one denominator per group in src/content/species-coverage.json.
const species = JSON.parse(
  readFileSync(path.join(process.cwd(), "src", "content", "species-coverage.json"), "utf8"),
) as { groups: { group: string; rows: { name: string; slug: string | null; excluded?: string }[] }[] };
console.log("\nspecies");
for (const group of species.groups) {
  const counted = group.rows.filter((row) => !row.excluded);
  const defined = counted.filter((row) => row.slug).length;
  const share = `${Math.round((defined / counted.length) * 100)}%`.padStart(4);
  console.log(`${group.group.padEnd(30)} ${String(defined).padStart(4)} / ${String(counted.length).padEnd(4)} ${share}`);
  if (showMissing) {
    for (const row of counted.filter((row) => !row.slug)) console.log(`    - ${row.name}`);
  }
}
