#!/usr/bin/env node
// Restore the expected screenshots without AWS credentials. Public S3 objects are treated as
// image input and re-encoded before reg-suit, and only the ones this run's captures could differ
// from are fetched at all (scripts/visual-baseline-plan.mjs).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  BASELINE_PLAN_FILE,
  clearPlan,
  hashScreenshots,
  planBaselineReuse,
  writePlan,
} from "./visual-baseline-plan.mjs";
import { mapConcurrent, reencodePng } from "./visual-publish-artifacts.mjs";
import {
  actualObjectKey,
  DEFAULT_BUCKET,
  fetchFromBucket,
  snapshotVersionFromReport,
} from "./visual-report-lib.mjs";

const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;
const SAFE_BASELINE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/u;
const SAFE_SCREENSHOT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}\.png$/u;
const MAX_SCREENSHOTS = 2_000;
const MAX_TOTAL_BYTES = 2_000_000_000;

function reportNames(report) {
  if (!snapshotVersionFromReport(report) || !Array.isArray(report.actualItems)) {
    throw new Error("baseline report has an unexpected shape");
  }
  if (report.actualItems.length > MAX_SCREENSHOTS) {
    throw new Error("baseline has too many screenshots");
  }
  const names = new Set();
  const screenshots = [];
  for (const name of report.actualItems) {
    if (typeof name !== "string" || !SAFE_BASELINE_NAME.test(name)) {
      throw new Error("baseline report contains an unsafe screenshot name");
    }
    if (names.has(name)) throw new Error(`baseline report contains a duplicate entry: ${name}`);
    names.add(name);
    // Print checks previously shared this directory with screenshots. Those
    // non-PNG outputs belong to the test artifact, not the visual baseline.
    if (SAFE_SCREENSHOT.test(name)) screenshots.push(name);
  }
  return screenshots;
}

/**
 * Fetch the baseline's report and then the images the compare needs of it.
 *
 * `actualDir` is this run's captures, already canonical. When the report carries main's content
 * hashes, only the captures whose bytes moved are fetched (scripts/visual-baseline-plan.mjs);
 * otherwise every baseline image is, as it always was.
 */
async function fetchBaseline({ bucket, key, version, fetchImpl, actualDir, selective }) {
  const manifest = await fetchFromBucket(bucket, `${key}/out.json`, { fetchImpl });
  if (!manifest.ok) {
    // Private/missing S3 objects can both be 403 when ListBucket is unavailable.
    if (manifest.status === 403 || manifest.status === 404) return { files: [], plan: null };
    throw new Error(`could not fetch baseline report (HTTP ${manifest.status})`);
  }

  let report;
  try {
    report = JSON.parse(manifest.body.toString("utf8"));
  } catch {
    throw new Error("baseline report is not valid JSON");
  }
  const reportVersion = snapshotVersionFromReport(report);
  if (!reportVersion) throw new Error("baseline report has unsafe image directories");
  if (version && version !== reportVersion) {
    throw new Error("baseline report version does not match the published marker");
  }
  const names = reportNames(report);
  const plan = actualDir
    ? planBaselineReuse({
        report: { ...report, actualItems: names },
        actualHashes: hashScreenshots(actualDir),
        selective,
      })
    : null;
  const wanted = plan ? plan.fetch : names;
  const files = [];
  let totalBytes = 0;
  // Downloads are I/O bound and re-encoding is CPU bound: keep both busy.
  await mapConcurrent(
    wanted,
    async (name) => {
      const result = await fetchFromBucket(bucket, actualObjectKey(key, report, name), {
        fetchImpl,
      });
      if (!result.ok) {
        throw new Error(`could not fetch baseline screenshot ${name} (HTTP ${result.status})`);
      }
      const canonical = await reencodePng(result.body, `baseline ${name}`);
      totalBytes += canonical.length;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error("baseline screenshots exceed the publisher limits");
      }
      files.push([name, canonical]);
    },
    8,
  );
  return { files, plan, baselineCount: names.length };
}

/** Prepare the expected-image directory from the public bucket, and the plan beside it. */
export async function prepareVisualBaseline({
  bucket = DEFAULT_BUCKET,
  key = "",
  version = "",
  actualDir = "",
  selective = false,
  outputDir,
  planFile = BASELINE_PLAN_FILE,
  fetchImpl,
}) {
  if (!outputDir) throw new Error("outputDir is required");
  if (!BUCKET_NAME.test(bucket)) throw new Error("bucket name is invalid");
  if (key && !COMMIT_SHA.test(key)) throw new Error("baseline key must be a full commit sha");
  if (key && !/^[0-9a-f]{64}$/u.test(version)) {
    throw new Error("baseline snapshot version is invalid");
  }

  // A plan from an earlier run in this checkout must never outlive the images it described.
  clearPlan(planFile);
  let files = [];
  let plan = null;
  let baselineCount = 0;
  if (key) {
    ({
      files,
      plan,
      baselineCount = 0,
    } = await fetchBaseline({
      bucket,
      key,
      version,
      fetchImpl,
      actualDir,
      selective,
    }));
  }
  if (plan) {
    console.log(
      `visual-prepare-baseline: ${plan.unchanged.length} of ${baselineCount} baseline screenshots ` +
        `match this run's captures by hash` +
        (plan.filled.length > 0
          ? `, ${plan.filled.length} were not captured (selective run)`
          : "") +
        `; fetched ${files.length}.`,
    );
  } else if (files.length > 0) {
    console.log(`visual-prepare-baseline: fetched ${files.length} public baseline screenshots.`);
  }

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  for (const [name, bytes] of files)
    writeFileSync(path.join(outputDir, name), bytes, { flag: "wx" });
  if (plan) writePlan(plan, planFile);
  return {
    count: files.length,
    totalBytes: files.reduce((sum, [, bytes]) => sum + bytes.length, 0),
    plan,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await prepareVisualBaseline({
      bucket: process.env.REG_SUIT_S3_BUCKET_NAME || DEFAULT_BUCKET,
      key: process.env.REG_EXPECTED_KEY ?? "",
      version: process.env.REG_EXPECTED_VERSION ?? "",
      actualDir: path.resolve(process.env.VISUAL_ACTUAL_DIR ?? "e2e/screenshots"),
      selective: process.env.VISUAL_FILL_FROM_EXPECTED === "true",
      outputDir: path.resolve(".reg/expected"),
    });
    console.log(`visual-prepare-baseline: ready with ${result.count} expected screenshots`);
  } catch (error) {
    console.error(`visual-prepare-baseline: ${error.message}`);
    process.exitCode = 1;
  }
}
