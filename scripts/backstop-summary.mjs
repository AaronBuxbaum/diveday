#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const reportDirectory = path.resolve("backstop_data/json_report");
const reportPath = path.join(reportDirectory, "jsonReport.json");
const outputDirectory = path.resolve("backstop_data/ci_report");
const manifestPath = path.join(outputDirectory, "diff-manifest.json");
const markdownPath = path.join(outputDirectory, "diff-summary.md");
const shardTotal = Number(process.env.BACKSTOP_SHARD_TOTAL || "1");
const shardIndex = Number(process.env.BACKSTOP_SHARD_INDEX || "0");

await mkdir(outputDirectory, { recursive: true });

let report = null;
let unavailableReason = null;

try {
  report = JSON.parse(await readFile(reportPath, "utf8"));
} catch (error) {
  unavailableReason = error instanceof Error ? error.message : String(error);
}

const tests = Array.isArray(report?.tests) ? report.tests : [];
const failures = tests
  .filter((test) => test.status !== "pass")
  .map(({ pair = {}, status }) => ({
    label: pair.label ?? null,
    selector: pair.selector ?? null,
    fileName: pair.fileName ?? null,
    status: status ?? "unknown",
    mismatchPercentage: pair.diff?.misMatchPercentage ?? null,
    rawMismatchPercentage: pair.diff?.rawMisMatchPercentage ?? null,
    isSameDimensions: pair.diff?.isSameDimensions ?? null,
    threshold: pair.misMatchThreshold ?? null,
    reference: pair.reference ?? null,
    test: pair.test ?? null,
    diff: pair.diffImage ?? null,
  }));

const manifest = {
  schemaVersion: 1,
  status: report ? (failures.length > 0 ? "differences" : "passed") : "unavailable",
  testSuite: report?.testSuite ?? null,
  shard:
    shardTotal > 1
      ? {
          index: shardIndex,
          total: shardTotal,
          label: `${shardIndex + 1}/${shardTotal}`,
        }
      : null,
  totals: {
    comparisons: tests.length,
    passed: tests.filter((test) => test.status === "pass").length,
    failed: failures.length,
  },
  failures,
  report: "backstop_data/json_report/jsonReport.json",
  ...(unavailableReason ? { unavailableReason } : {}),
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

function markdownValue(value) {
  return String(value ?? "—")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function artifactLink(relativeToReport) {
  if (!relativeToReport) return "—";
  const absolute = path.resolve(reportDirectory, relativeToReport);
  const relative = path.relative(outputDirectory, absolute).replaceAll(path.sep, "/");
  return `[open diff](${relative})`;
}

const markdown = [
  "## Machine-readable Backstop diff summary",
  "",
  ...(shardTotal > 1 ? [`Shard: **${shardIndex + 1}/${shardTotal}**`, ""] : []),
  `Status: **${manifest.status}**`,
  `Comparisons: ${manifest.totals.comparisons}; passed: ${manifest.totals.passed}; failed: ${manifest.totals.failed}`,
  "",
];

if (failures.length > 0) {
  markdown.push(
    "| Scenario | Viewport image | Mismatch | Dimensions | Diff |",
    "| --- | --- | ---: | --- | --- |",
  );
  for (const failure of failures) {
    markdown.push(
      `| ${markdownValue(failure.label)} | ${markdownValue(failure.fileName)} | ${markdownValue(failure.mismatchPercentage)}% | ${failure.isSameDimensions === null ? "—" : failure.isSameDimensions ? "same" : "changed"} | ${artifactLink(failure.diff)} |`,
    );
  }
} else if (unavailableReason) {
  markdown.push(
    `The Backstop JSON report was unavailable: \`${markdownValue(unavailableReason)}\``,
  );
} else {
  markdown.push("No visual differences were found.");
}

markdown.push(
  "",
  "The complete JSON manifest is available at `backstop_data/ci_report/diff-manifest.json`; the raw Backstop report is at `backstop_data/json_report/jsonReport.json`.",
  "",
);

await writeFile(markdownPath, `${markdown.join("\n")}\n`);
