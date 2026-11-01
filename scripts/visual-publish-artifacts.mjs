#!/usr/bin/env node
// Copy screenshot artifacts into reg-suit's input directory as inert PNG data.
// The trusted reusable workflow downloads each fixed artifact into RUNNER_TEMP;
// artifact contents never become scripts, package metadata, or workflow paths.
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SAFE_SCREENSHOT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}\.png$/u;
const MAX_SCREENSHOTS = 2_000;
const MAX_FILE_BYTES = 20_000_000;
const MAX_TOTAL_BYTES = 2_000_000_000;
const MAX_IMAGE_PIXELS = 100_000_000;
const MAX_CAPTURE_MANIFEST_BYTES = 1_000_000;
const MAX_VISUAL_PLAN_BYTES = 1_000_000;

/**
 * Run `task` over `items` with at most `limit` in flight. The first failure
 * stops new work and is rethrown once the running tasks settle.
 */
export async function mapConcurrent(items, task, limit = availableParallelism()) {
  let cursor = 0;
  let failure;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length && !failure) {
      const item = items[cursor++];
      try {
        await task(item);
      } catch (error) {
        failure ??= error;
      }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;
}

/** Decode untrusted PNG bytes and emit a metadata-free canonical PNG. */
export async function reencodePng(bytes, label = "screenshot") {
  if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`invalid PNG data: ${label}`);
  }

  let image;
  let metadata;
  try {
    image = sharp(bytes, { failOn: "warning", limitInputPixels: MAX_IMAGE_PIXELS });
    metadata = await image.metadata();
  } catch {
    throw new Error(`malformed PNG data: ${label}`);
  }
  if (
    metadata.format !== "png" ||
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > MAX_IMAGE_PIXELS ||
    (metadata.pages !== undefined && metadata.pages !== 1)
  ) {
    throw new Error(`unsupported PNG dimensions or animation: ${label}`);
  }

  let canonical;
  try {
    // Level 9 with adaptive filtering cost ~0.3 s per screenshot, single-threaded
    // per image, for ~800 images on every run. Pixels are identical at any level;
    // only the bytes in the cache and bucket grow a little.
    canonical = await image.png({ compressionLevel: 3, adaptiveFiltering: false }).toBuffer();
  } catch {
    throw new Error(`malformed PNG data: ${label}`);
  }
  if (canonical.length > MAX_FILE_BYTES) {
    throw new Error(`re-encoded PNG exceeds the allowed size: ${label}`);
  }
  return canonical;
}

export function parseCaptureShards(value) {
  let shards;
  try {
    shards = JSON.parse(value);
  } catch {
    throw new Error("capture shard list must be JSON");
  }
  if (
    !Array.isArray(shards) ||
    shards.length < 1 ||
    shards.length > 8 ||
    shards.some((shard, index) => !Number.isInteger(shard) || shard !== index + 1)
  ) {
    throw new Error("capture shard list must be a consecutive prefix from 1 through 8");
  }
  return shards;
}

export function validateCaptureSelection(mode, shards) {
  if (!["all", "affected", "light"].includes(mode)) {
    throw new Error("capture mode must be all, affected, or light");
  }
  const parsed = parseCaptureShards(shards);
  if (mode === "all" && parsed.length !== 8) {
    throw new Error("all-capture mode must include every shard from 1 through 8");
  }
  return parsed;
}

function requireDirectory(directory, label) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
}

function screenshotInventory(directory, label) {
  requireDirectory(directory, label);
  const names = new Set();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const stat = lstatSync(file);
    if (!entry.isFile() || entry.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`${label} contains a non-file entry`);
    }
    if (!SAFE_SCREENSHOT.test(entry.name)) {
      throw new Error(`${label} contains an unsafe screenshot name`);
    }
    names.add(entry.name);
  }
  return names;
}

function readCaptureIntents(directory, label) {
  requireDirectory(directory, label);
  const captures = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const stat = lstatSync(file);
    if (!entry.isFile() || entry.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`${label} contains a non-file entry`);
    }
    if (!entry.name.endsWith(".png.json") || stat.size > 4_096) {
      throw new Error(`${label} contains an invalid capture manifest entry`);
    }
    const name = entry.name.slice(0, -".json".length);
    if (!SAFE_SCREENSHOT.test(name)) {
      throw new Error(`${label} contains an unsafe screenshot name`);
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new Error(`${label} contains invalid capture manifest JSON`);
    }
    if (
      manifest?.version !== 1 ||
      manifest.screenshot !== name ||
      typeof manifest.testId !== "string" ||
      manifest.testId.length < 1 ||
      manifest.testId.length > 512
    ) {
      throw new Error(`${label} contains invalid capture manifest data`);
    }
    captures.push({ name, testId: manifest.testId });
  }
  return captures;
}

function readCompleteCaptureManifest(file) {
  if (!file) throw new Error("fresh baseline requires its complete capture manifest");
  let stat;
  let manifest;
  try {
    stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CAPTURE_MANIFEST_BYTES) {
      throw new Error("invalid capture manifest file");
    }
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error("fresh baseline capture manifest is missing or invalid");
  }
  if (
    manifest?.version !== 1 ||
    !Array.isArray(manifest.captures) ||
    manifest.captures.length < 1 ||
    manifest.captures.length > MAX_SCREENSHOTS
  ) {
    throw new Error("fresh baseline capture manifest has an invalid inventory");
  }
  const names = new Set();
  for (const capture of manifest.captures) {
    if (
      !SAFE_SCREENSHOT.test(capture?.name ?? "") ||
      typeof capture.testId !== "string" ||
      capture.testId.length < 1 ||
      capture.testId.length > 512 ||
      names.has(capture.name)
    ) {
      throw new Error("fresh baseline capture manifest has an unsafe or duplicate entry");
    }
    names.add(capture.name);
  }
  return names;
}

function readExpectedCaptureTestIds(file) {
  if (!file) throw new Error("the complete visual capture test plan is missing");
  let stat;
  let plan;
  try {
    stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_VISUAL_PLAN_BYTES) {
      throw new Error("invalid visual capture test plan");
    }
    plan = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error("the complete visual capture test plan is missing or invalid");
  }
  if (
    !Array.isArray(plan.expectedCaptureTestIds) ||
    plan.expectedCaptureTestIds.length < 1 ||
    plan.expectedCaptureTestIds.length > MAX_SCREENSHOTS
  ) {
    throw new Error("the complete visual capture test plan has an invalid test inventory");
  }
  const ids = new Set();
  for (const id of plan.expectedCaptureTestIds) {
    if (typeof id !== "string" || id.length < 1 || id.length > 512 || ids.has(id)) {
      throw new Error("the complete visual capture test plan has an unsafe or duplicate test ID");
    }
    ids.add(id);
  }
  return ids;
}

/** Require a complete capture, except when a full-capture fresh start has no baseline yet. */
export function verifyCompleteScreenshotInventory({
  actualDir,
  expectedDir,
  requireExpected = false,
  allowEmptyExpected = false,
  captureMode = "",
  captureManifest = "",
}) {
  const actual = screenshotInventory(actualDir, "actual screenshots");
  const expected = screenshotInventory(expectedDir, "expected screenshots");
  if (allowEmptyExpected && captureMode !== "all") {
    throw new Error("fresh baseline requires a complete all-mode capture");
  }
  if (allowEmptyExpected) {
    if (expected.size > 0) {
      throw new Error("fresh baseline cannot reuse an existing screenshot inventory");
    }
    const planned = readCompleteCaptureManifest(captureManifest);
    const missing = [...planned].filter((name) => !actual.has(name));
    const unexpected = [...actual].filter((name) => !planned.has(name));
    if (missing.length > 0 || unexpected.length > 0) {
      throw new Error(
        `fresh baseline capture differs from its complete manifest: ${missing.length} ` +
          `missing and ${unexpected.length} unexpected screenshots`,
      );
    }
  }
  if (requireExpected && !allowEmptyExpected && expected.size === 0) {
    throw new Error("no trusted baseline screenshot inventory is available for this PR");
  }
  const missing = [...expected].filter((name) => !actual.has(name));
  if (missing.length > 0) {
    throw new Error(
      `visual capture is incomplete: ${missing.length} of ${expected.size} baseline screenshots are missing`,
    );
  }
  return { actualCount: actual.size, expectedCount: expected.size };
}

export async function sanitizeVisualArtifacts({ root, output, shards, expectedTests }) {
  const validatedShards = Array.isArray(shards)
    ? parseCaptureShards(JSON.stringify(shards))
    : parseCaptureShards(shards);
  requireDirectory(root, "artifact root");
  const expectedTestIds = readExpectedCaptureTestIds(expectedTests);

  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });

  const names = new Set();
  const captureNames = new Set();
  const captures = [];
  const encodeJobs = [];
  let totalBytes = 0;
  for (const shard of validatedShards) {
    const source = path.join(root, `shard-${shard}`);
    requireDirectory(source, `shard ${shard} artifact`);
    const screenshotDirectory = path.join(source, "screenshots");
    const captureDirectory = path.join(source, "capture-manifest");
    const entries = readdirSync(source, { withFileTypes: true });
    if (
      entries.length !== 2 ||
      !entries.some((entry) => entry.name === "screenshots" && entry.isDirectory()) ||
      !entries.some((entry) => entry.name === "capture-manifest" && entry.isDirectory())
    ) {
      throw new Error(`shard ${shard} must contain screenshots and a capture manifest`);
    }
    requireDirectory(screenshotDirectory, `shard ${shard} screenshots`);
    const intents = readCaptureIntents(captureDirectory, `shard ${shard} capture manifest`);
    const shardExpected = new Set();
    for (const capture of intents) {
      if (shardExpected.has(capture.name) || captureNames.has(capture.name)) {
        throw new Error(`duplicate screenshot in capture manifest: ${capture.name}`);
      }
      shardExpected.add(capture.name);
      captureNames.add(capture.name);
      captures.push(capture);
    }

    const shardActual = new Set();
    for (const entry of readdirSync(screenshotDirectory, { withFileTypes: true })) {
      const file = path.join(screenshotDirectory, entry.name);
      const stat = lstatSync(file);
      if (!entry.isFile() || entry.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`shard ${shard} contains a non-file artifact entry`);
      }
      if (!SAFE_SCREENSHOT.test(entry.name)) {
        throw new Error(`shard ${shard} contains a non-screenshot filename`);
      }
      if (names.has(entry.name)) throw new Error(`duplicate screenshot artifact: ${entry.name}`);
      shardActual.add(entry.name);
      if (stat.size < PNG_SIGNATURE.length || stat.size > MAX_FILE_BYTES) {
        throw new Error(`screenshot size is outside the allowed range: ${entry.name}`);
      }
      if (names.size >= MAX_SCREENSHOTS || totalBytes + stat.size > MAX_TOTAL_BYTES) {
        throw new Error("screenshot artifacts exceed the publisher limits");
      }
      names.add(entry.name);
      encodeJobs.push({ file, name: entry.name });
    }
    const missing = [...shardExpected].filter((name) => !shardActual.has(name));
    const unexpected = [...shardActual].filter((name) => !shardExpected.has(name));
    if (missing.length > 0 || unexpected.length > 0) {
      throw new Error(
        `shard ${shard} screenshots do not match the capture manifest: ${missing.length} ` +
          `missing and ${unexpected.length} unexpected images`,
      );
    }
  }
  // Re-encode after every name check passed, several at a time.
  await mapConcurrent(encodeJobs, async ({ file, name }) => {
    const canonical = await reencodePng(readFileSync(file, { encoding: null, flag: "r" }), name);
    writeFileSync(path.join(output, name), canonical, { flag: "wx" });
    totalBytes += canonical.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("screenshot artifacts exceed the publisher limits");
    }
  });
  if (names.size === 0) throw new Error("no screenshot files were found in the artifacts");
  const capturedTestIds = new Set(captures.map((capture) => capture.testId));
  const missingTests = [...expectedTestIds].filter((testId) => !capturedTestIds.has(testId));
  const unexpectedTests = [...capturedTestIds].filter((testId) => !expectedTestIds.has(testId));
  if (missingTests.length > 0 || unexpectedTests.length > 0) {
    const formatTestIds = (testIds) =>
      testIds.length === 0
        ? "(none)"
        : testIds
            .slice(0, 10)
            .map((testId) => JSON.stringify(testId.slice(0, 180)))
            .join(", ") + (testIds.length > 10 ? `, … ${testIds.length - 10} more` : "");
    throw new Error(
      `capture test IDs do not match the complete visual plan: ${missingTests.length} ` +
        `missing and ${unexpectedTests.length} unexpected; missing IDs: ${formatTestIds(missingTests)}; ` +
        `unexpected IDs: ${formatTestIds(unexpectedTests)}`,
    );
  }
  return {
    count: names.size,
    totalBytes,
    captures: captures.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    testCount: capturedTestIds.size,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (process.argv.includes("--validate-selection")) {
      const shards = validateCaptureSelection(
        process.env.VISUAL_CAPTURE_MODE ?? "",
        process.env.VISUAL_CAPTURE_SHARDS ?? "",
      );
      console.log(`visual-publish-artifacts: complete selection verified (${shards.join(",")})`);
      process.exit(0);
    }
    if (process.argv.includes("--verify-complete")) {
      const result = verifyCompleteScreenshotInventory({
        actualDir: path.resolve(process.env.VISUAL_ACTUAL_DIR ?? "e2e/screenshots"),
        expectedDir: path.resolve(process.env.VISUAL_EXPECTED_DIR ?? ".reg/expected"),
        requireExpected: process.env.GITHUB_EVENT_NAME === "pull_request",
        allowEmptyExpected: process.env.VISUAL_FRESH_START === "true",
        captureMode: process.env.VISUAL_CAPTURE_MODE ?? "",
        captureManifest: process.env.VISUAL_EXPECTED_CAPTURE_MANIFEST ?? "",
      });
      console.log(
        `visual-publish-artifacts: verified ${result.actualCount} captures against ` +
          `${result.expectedCount} trusted baseline screenshots`,
      );
      process.exit(0);
    }
    const root = process.env.VISUAL_ARTIFACT_ROOT;
    const output = path.resolve("e2e/screenshots");
    if (!root) throw new Error("VISUAL_ARTIFACT_ROOT is required");
    const result = await sanitizeVisualArtifacts({
      root,
      output,
      shards: process.env.VISUAL_CAPTURE_SHARDS ?? "",
      expectedTests: process.env.VISUAL_EXPECTED_CAPTURE_TESTS ?? "",
    });
    const manifestPath = path.resolve(
      process.env.VISUAL_EXPECTED_CAPTURE_MANIFEST ?? ".reg/capture-manifest.json",
    );
    mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify({ version: 1, captures: result.captures })}\n`, {
      flag: "w",
    });
    console.log(
      `visual-publish-artifacts: accepted ${result.count} PNG screenshots and verified ` +
        `${result.testCount} planned screenshot tests across ${result.captures.length} capture intents`,
    );
  } catch (error) {
    console.error(`visual-publish-artifacts: ${error.message}`);
    process.exitCode = 1;
  }
}
