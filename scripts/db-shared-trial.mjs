// A trial is comparable only with complete, matching, successful paired fleets.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TRIAL_SEEDS = [441601, 441602, 441603];

export function compareTrial(rows) {
  if (rows.length !== 36)
    throw new Error("Expected all 36 receipts (3 seeds × 2 modes × 6 shards)");
  const keys = new Set();
  const identities = new Set();
  for (const row of rows) {
    const key = `${row.seed}/${row.mode}/${row.shard}`;
    if (keys.has(key)) throw new Error(`Duplicate receipt ${key}`);
    keys.add(key);
    if (
      !TRIAL_SEEDS.includes(row.seed) ||
      !["isolated", "shared"].includes(row.mode) ||
      !Number.isInteger(row.shard) ||
      row.shard < 1 ||
      row.shard > 6
    )
      throw new Error(`Invalid receipt ${key}`);
    if (
      row.exitCode !== 0 ||
      !row.success ||
      !row.coverage ||
      row.shards !== 6 ||
      !Number.isFinite(row.elapsedSeconds) ||
      row.elapsedSeconds <= 0 ||
      !row.files.length ||
      row.tests <= 0 ||
      !Number.isInteger(row.passedTests) ||
      !Number.isInteger(row.pendingTests) ||
      row.passedTests + row.pendingTests !== row.tests ||
      new Set(row.files).size !== row.files.length
    )
      throw new Error(
        `Failed or incomplete trial ${key}; investigate and revert any shared-only/order-dependent failure`,
      );
    if (!row.sha || !row.runner || !row.nodeMajor) throw new Error(`Missing provenance ${key}`);
    identities.add(JSON.stringify([row.sha, row.runner, row.nodeMajor]));
  }
  if (identities.size !== 1) throw new Error("Mixed commit/runner/Node provenance");
  const lines = [
    "| Seed | Shard | Isolated seconds | Shared seconds | Files | Passed / pending tests |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
  ];
  let expectedFiles;
  for (const seed of TRIAL_SEEDS) {
    const fleets = ["isolated", "shared"].map((mode) =>
      rows.filter((r) => r.seed === seed && r.mode === mode).sort((a, b) => a.shard - b.shard),
    );
    for (const fleet of fleets) {
      const files = fleet.flatMap((r) => r.files).sort();
      if (new Set(files).size !== files.length) throw new Error("File executed in multiple shards");
      const signature = JSON.stringify(files);
      expectedFiles ??= signature;
      if (signature !== expectedFiles) throw new Error("Fleet file set differs");
    }
    for (let i = 0; i < 6; i++) {
      const [before, after] = fleets.map((fleet) => fleet[i]);
      if (
        JSON.stringify([...before.files].sort()) !== JSON.stringify([...after.files].sort()) ||
        before.tests !== after.tests ||
        before.passedTests !== after.passedTests ||
        before.pendingTests !== after.pendingTests
      )
        throw new Error(`Shard membership/test count differs at ${seed}/${i + 1}`);
      lines.push(
        `| ${seed} | ${i + 1} | ${before.elapsedSeconds} | ${after.elapsedSeconds} | ${before.files.length} | ${before.passedTests} / ${before.pendingTests} |`,
      );
    }
    const [before, after] = fleets.map((fleet) => Math.max(...fleet.map((r) => r.elapsedSeconds)));
    lines.push(`| ${seed} | slowest | ${before} | ${after} |`);
  }
  return `Commit ${rows[0].sha}; ${rows[0].runner}; Node ${rows[0].nodeMajor}; coverage enabled in both modes.\n\n${lines.join("\n")}\n\nElapsed test-command time, including setup/imports/coverage; excludes dependency installation. Passing receipts still require all six merged coverage-floor checks and review of failures/logs before acceptance.\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2];
  const rows = readdirSync(root, { recursive: true })
    .filter((file) => file.endsWith("receipt.json"))
    .map((file) => JSON.parse(readFileSync(path.join(root, file), "utf8")));
  console.log(compareTrial(rows));
}
