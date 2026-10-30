#!/usr/bin/env node
// Restore the expected screenshots without AWS credentials. Cache entries and
// public S3 objects are treated as image input and re-encoded before reg-suit.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { reencodePng } from "./visual-publish-artifacts.mjs";
import { DEFAULT_BUCKET, fetchFromBucket } from "./visual-report-lib.mjs";

const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;
const SAFE_BASELINE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/u;
const SAFE_SCREENSHOT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}\.png$/u;
const MAX_SCREENSHOTS = 2_000;
const MAX_TOTAL_BYTES = 2_000_000_000;

function requireDirectory(directory, label) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
}

function reportNames(report) {
  if (report?.actualDir !== "actual" || !Array.isArray(report.actualItems)) {
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

async function fetchBaseline({ bucket, key, fetchImpl }) {
  const manifest = await fetchFromBucket(bucket, `${key}/out.json`, { fetchImpl });
  if (!manifest.ok) {
    // Private/missing S3 objects can both be 403 when ListBucket is unavailable.
    if (manifest.status === 403 || manifest.status === 404) return [];
    throw new Error(`could not fetch baseline report (HTTP ${manifest.status})`);
  }

  let report;
  try {
    report = JSON.parse(manifest.body.toString("utf8"));
  } catch {
    throw new Error("baseline report is not valid JSON");
  }
  const names = reportNames(report);
  const files = [];
  let cursor = 0;
  let totalBytes = 0;
  let failure;
  const workers = Array.from({ length: Math.min(2, names.length) }, async () => {
    while (cursor < names.length && !failure) {
      const name = names[cursor++];
      const result = await fetchFromBucket(bucket, `${key}/actual/${name}`, { fetchImpl });
      if (!result.ok) {
        failure = new Error(`could not fetch baseline screenshot ${name} (HTTP ${result.status})`);
        return;
      }
      try {
        const canonical = await reencodePng(result.body, `baseline ${name}`);
        totalBytes += canonical.length;
        if (totalBytes > MAX_TOTAL_BYTES) {
          throw new Error("baseline screenshots exceed the publisher limits");
        }
        files.push([name, canonical]);
      } catch (error) {
        failure = error;
        return;
      }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;
  return files;
}

async function reencodeCachedBaseline(sourceDir) {
  requireDirectory(sourceDir, "cached baseline");
  const files = [];
  let totalBytes = 0;
  const entries = readdirSync(sourceDir, { withFileTypes: true });
  if (entries.length > MAX_SCREENSHOTS) {
    throw new Error("cached baseline has too many entries");
  }
  for (const entry of entries) {
    const file = path.join(sourceDir, entry.name);
    const stat = lstatSync(file);
    if (!entry.isFile() || entry.isSymbolicLink() || !stat.isFile()) {
      throw new Error("cached baseline contains a non-file entry");
    }
    if (stat.size > 20_000_000) {
      throw new Error("cached baseline exceeds the publisher limits");
    }
    // Cache folders may contain metadata files alongside screenshots. They
    // are never opened or copied; only PNGs are comparison inputs.
    if (!entry.name.toLowerCase().endsWith(".png")) continue;
    if (!SAFE_BASELINE_NAME.test(entry.name) || !SAFE_SCREENSHOT.test(entry.name)) {
      throw new Error("cached baseline contains an unsafe filename");
    }
    if (files.length >= MAX_SCREENSHOTS) {
      throw new Error("cached baseline exceeds the publisher limits");
    }
    const canonical = await reencodePng(readFileSync(file), `cached baseline ${entry.name}`);
    totalBytes += canonical.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("cached baseline exceeds the publisher limits");
    }
    files.push([entry.name, canonical]);
  }
  return files;
}

/** Prepare a canonical expected-image directory from a trusted cache or public bucket. */
export async function prepareVisualBaseline({
  bucket = DEFAULT_BUCKET,
  key = "",
  sourceDir = "",
  sourceKey = "",
  outputDir,
  fetchImpl = fetch,
}) {
  if (!outputDir) throw new Error("outputDir is required");
  if (!BUCKET_NAME.test(bucket)) throw new Error("bucket name is invalid");
  if (key && !COMMIT_SHA.test(key)) throw new Error("baseline key must be a full commit sha");

  let files = [];
  if (sourceDir && sourceKey === `reg-baseline-${key}` && existsSync(sourceDir)) {
    files = await reencodeCachedBaseline(sourceDir);
    if (files.length > 0) {
      console.log(`visual-prepare-baseline: using ${files.length} cached screenshots.`);
    }
  }
  if (files.length === 0 && key) {
    files = await fetchBaseline({ bucket, key, fetchImpl });
    if (files.length > 0) {
      console.log(`visual-prepare-baseline: fetched ${files.length} public baseline screenshots.`);
    }
  }

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  for (const [name, bytes] of files)
    writeFileSync(path.join(outputDir, name), bytes, { flag: "wx" });
  return {
    count: files.length,
    totalBytes: files.reduce((sum, [, bytes]) => sum + bytes.length, 0),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await prepareVisualBaseline({
      bucket: process.env.REG_SUIT_S3_BUCKET_NAME || DEFAULT_BUCKET,
      key: process.env.REG_EXPECTED_KEY ?? "",
      sourceDir: process.env.VISUAL_BASELINE_DIR ?? "",
      sourceKey: process.env.VISUAL_BASELINE_KEY ?? "",
      outputDir: path.resolve(".reg/expected"),
    });
    console.log(`visual-prepare-baseline: ready with ${result.count} expected screenshots`);
  } catch (error) {
    console.error(`visual-prepare-baseline: ${error.message}`);
    process.exitCode = 1;
  }
}
