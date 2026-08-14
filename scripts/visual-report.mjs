#!/usr/bin/env node
// Fetches a reg-suit report straight from S3 and turns it into flat, local
// files: a markdown summary plus the actual/expected/diff PNGs. This exists
// because the hosted report (`index.html`) is a client-rendered SPA — its
// body is just `<div id="app"></div>` until JS runs, so a text-only fetch
// (an agent's WebFetch, a naive `curl`) sees nothing. `out.json` and the PNGs
// are flat static files on the same public bucket; this script is the
// documented way to reach them. See ADR 20260729-reg-suit-visual-regression.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import {
  countsLine,
  DEFAULT_BUCKET,
  fetchFromBucket,
  hostedReportUrl,
  summarizeReport,
  verdictHeadline,
} from "./visual-report-lib.mjs";

function parseArgs(argv) {
  const args = { out: ".reg-report", all: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--commit") args.commit = argv[++i];
    else if (arg === "--bucket") args.bucket = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--all") args.all = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      console.error(
        "Usage: node scripts/visual-report.mjs [--commit <sha>] [--bucket <name>] [--out <dir>] [--all]",
      );
      process.exit(1);
    }
  }
  return args;
}

function currentCommit() {
  return readBounded("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    timeoutMs: SUBPROCESS_TIMEOUTS.git,
  }).trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bucket = args.bucket || process.env.REG_SUIT_S3_BUCKET_NAME || DEFAULT_BUCKET;
  const commit = args.commit || currentCommit();

  console.log(`Fetching reg-suit report for ${commit} from bucket "${bucket}"...`);

  const manifest = await fetchFromBucket(bucket, `${commit}/out.json`);
  if (!manifest.ok) {
    console.error(
      `No reg-suit report at ${manifest.url} (HTTP ${manifest.status}).\n` +
        "This usually means the `visual` CI job hasn't finished for this commit yet, this commit was " +
        "never pushed to CI (e.g. an uncommitted or amended local change), or REG_SUIT_S3_BUCKET_NAME " +
        "points at a different bucket than CI publishes to.",
    );
    process.exit(1);
  }

  const report = JSON.parse(manifest.body.toString("utf8"));
  const summary = summarizeReport(report);
  const dirs = { actual: report.actualDir, expected: report.expectedDir, diff: report.diffDir };
  const outDir = path.resolve(args.out, commit);

  const items = [
    ...report.failedItems.map((name) => ({
      name,
      kind: "changed",
      want: ["expected", "actual", "diff"],
    })),
    ...report.newItems.map((name) => ({ name, kind: "new", want: ["actual"] })),
    ...report.deletedItems.map((name) => ({ name, kind: "deleted", want: ["expected"] })),
    ...(args.all
      ? report.passedItems.map((name) => ({ name, kind: "passed", want: ["expected", "actual"] }))
      : []),
  ];

  let downloadCount = 0;
  const skipped = [];
  for (const item of items) {
    item.files = {};
    for (const dirKind of item.want) {
      const remote = `${commit}/${dirs[dirKind]}/${item.name}`;
      const local = path.join(outDir, dirKind, item.name);
      const result = await fetchFromBucket(bucket, remote);
      if (!result.ok) {
        console.warn(`  skip ${remote}: HTTP ${result.status}`);
        skipped.push({ remote, status: result.status });
        continue;
      }
      mkdirSync(path.dirname(local), { recursive: true });
      writeFileSync(local, result.body);
      item.files[dirKind] = local;
      downloadCount++;
    }
  }

  const lines = [
    `# reg-suit report — ${commit}`,
    "",
    // The headline before the counts, deliberately: a run where baseline
    // resolution failed reports zero changed items while having compared
    // nothing, and the counts line alone reads as a clean pass.
    verdictHeadline(summary),
    "",
    countsLine(summary),
    `Baseline images downloaded: ${summary.baselineCount} · Captured: ${summary.capturedCount}`,
    "",
    `Hosted report (needs a browser, not agent-fetchable): ${hostedReportUrl(bucket, commit)}`,
    "",
  ];

  for (const warning of summary.warnings) lines.push(`> ${warning}`, "");

  for (const item of items) {
    lines.push(`## ${item.name} (${item.kind})`);
    for (const [dirKind, local] of Object.entries(item.files)) {
      lines.push(`- ${dirKind}: ${path.relative(process.cwd(), local)}`);
    }
    lines.push("");
  }

  if (!args.all && report.passedItems.length) {
    lines.push(
      `${report.passedItems.length} passed item(s) were not downloaded — pass --all to include them.`,
    );
  }

  if (skipped.length) {
    lines.push("", "## Skipped downloads", "");
    lines.push(
      "The report above may be incomplete — these objects failed to fetch from S3 and are not on disk:",
    );
    for (const { remote, status } of skipped) {
      lines.push(`- ${remote} (HTTP ${status})`);
    }
  }

  const summaryPath = path.join(outDir, "REPORT.md");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(summaryPath, lines.join("\n"));

  console.log(lines.join("\n"));
  console.log(`Wrote ${summaryPath} and ${downloadCount} image(s) under ${outDir}`);
  if (skipped.length) {
    console.warn(
      `${skipped.length} object(s) failed to download — see "Skipped downloads" in REPORT.md`,
    );
  }
  if (summary.verdict === "no-baseline" || summary.verdict === "nothing-captured") {
    console.warn(
      `\n${verdictHeadline(summary)}\nThis run compared nothing. Do not read its zero changed ` +
        "items as evidence that the pixels held still — see ADR " +
        "20260729-reg-suit-visual-regression.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
