#!/usr/bin/env node
// Restore the expected screenshots without AWS credentials. Public S3 objects are treated as
// image input and re-encoded before reg-suit, and only the ones this run's captures could differ
// from are fetched at all (scripts/visual-baseline-plan.mjs).
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { gitReader } from "./reg-suit-keys.mjs";
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
import { baselineEnvironment, nearestPublishedAncestor } from "./wait-for-baseline.mjs";

const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;
const SAFE_BASELINE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/u;
const SAFE_SCREENSHOT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}\.png$/u;
const MAX_SCREENSHOTS = 2_000;
const MAX_TOTAL_BYTES = 2_000_000_000;

/** How many times a missing snapshot hands over to the next main-owned one before none is used. */
export const MAX_BASELINE_FALLBACKS = 3;

/**
 * A resolved snapshot whose report or an image it names is not in the bucket (S3 answers 403 or
 * 404 for a missing public object). Not an integrity failure: the caller falls back to the next
 * main-owned snapshot instead of failing the run (issue #3968).
 */
export class MissingBaselineObject extends Error {}

const missing = (status) => status === 403 || status === 404;

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
    if (missing(manifest.status)) {
      throw new MissingBaselineObject(`baseline ${key} has no report in the bucket`);
    }
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
        key,
        version: reportVersion,
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
        if (missing(result.status)) {
          throw new MissingBaselineObject(`baseline ${key} is missing screenshot ${name}`);
        }
        throw new Error(`could not fetch baseline screenshot ${name} (HTTP ${result.status})`);
      }
      // A content address is a claim until the bytes agree with it.
      const claimed = report.actualBlobs?.[name];
      if (claimed && createHash("sha256").update(result.body).digest("hex") !== claimed) {
        throw new Error(`baseline screenshot ${name} does not match its content hash`);
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

/**
 * **Prepare against the nearest usable baseline** (issue #3968: never wait on, or fail for, a
 * missing one). The resolved snapshot first; when its report or an image it names is missing from
 * the bucket, the nearest main-owned snapshot before it (`nearestPublishedAncestor`, which never
 * takes a marker a pull request published), up to `maxFallbacks` times; then none, so the compare
 * reports its captures as new and says so. Bounded, and it never polls. Anything that is not a
 * missing object (a hash that disagrees, a malformed report, an outage) still throws.
 *
 * Returns the prepared result with the `key` and `version` actually used, and `passedOver`, the
 * snapshots it gave up on, so the caller can export the baseline the compare must name.
 *
 * @param git a reader taking an argv array and returning stdout, throwing on failure
 */
export async function prepareNearestBaseline({
  git,
  key = "",
  version = "",
  maxFallbacks = MAX_BASELINE_FALLBACKS,
  ...input
}) {
  const passedOver = [];
  let candidate = { key, version };
  for (;;) {
    try {
      const result = await prepareVisualBaseline({ ...input, ...candidate });
      return { ...result, ...candidate, passedOver };
    } catch (error) {
      if (!(error instanceof MissingBaselineObject)) throw error;
      console.log(`::warning title=Baseline incomplete::${error.message}; trying an older one.`);
    }
    passedOver.push(candidate.key);
    candidate = { key: "", version: "" };
    if (passedOver.length > maxFallbacks) continue;
    let parent = "";
    try {
      parent = git(["rev-parse", `${passedOver.at(-1)}^`]).trim();
    } catch {
      continue;
    }
    if (!COMMIT_SHA.test(parent)) continue;
    const next = await nearestPublishedAncestor({
      bucket: input.bucket ?? DEFAULT_BUCKET,
      key: parent,
      git,
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    }).catch(() => null);
    if (next?.key && next.version) candidate = { key: next.key, version: next.version };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const expectedKey = process.env.REG_EXPECTED_KEY ?? "";
    const result = await prepareNearestBaseline({
      git: gitReader(),
      bucket: process.env.REG_SUIT_S3_BUCKET_NAME || DEFAULT_BUCKET,
      key: expectedKey,
      version: process.env.REG_EXPECTED_VERSION ?? "",
      actualDir: path.resolve(process.env.VISUAL_ACTUAL_DIR ?? "e2e/screenshots"),
      selective: process.env.VISUAL_FILL_FROM_EXPECTED === "true",
      outputDir: path.resolve(".reg/expected"),
    });
    if (result.passedOver.length > 0) {
      // The compare and the sticky comment read the baseline from the environment: name the one
      // the expected images actually came from.
      const note = result.key
        ? `Baseline is ${result.key.slice(0, 7)}: ${result.passedOver.map((sha) => sha.slice(0, 7)).join(", ")} ` +
          "had images missing from the bucket. Any surface main moved between them is reported here as this run's."
        : `No complete main baseline was found near ${expectedKey.slice(0, 7)}; every capture is reported as new.`;
      console.log(`::warning title=Baseline resolved to an older snapshot::${note}`);
      const file = process.env.GITHUB_ENV;
      if (file) {
        const lines = baselineEnvironment({ key: result.key, version: result.version, note });
        appendFileSync(file, `${lines.join("\n")}\n`);
      }
    }
    console.log(`visual-prepare-baseline: ready with ${result.count} expected screenshots`);
  } catch (error) {
    console.error(`visual-prepare-baseline: ${error.message}`);
    process.exitCode = 1;
  }
}
