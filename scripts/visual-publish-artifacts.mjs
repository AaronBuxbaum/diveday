#!/usr/bin/env node
// Copy screenshot artifacts into reg-suit's input directory as inert PNG data.
// The trusted reusable workflow downloads each fixed artifact into RUNNER_TEMP;
// artifact contents never become scripts, package metadata, or workflow paths.
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SAFE_SCREENSHOT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}\.png$/u;
const MAX_SCREENSHOTS = 2_000;
const MAX_FILE_BYTES = 20_000_000;
const MAX_TOTAL_BYTES = 2_000_000_000;
const MAX_IMAGE_PIXELS = 100_000_000;

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
    canonical = await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
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

/** Require a complete capture, except when a full-capture fresh start has no baseline yet. */
export function verifyCompleteScreenshotInventory({
  actualDir,
  expectedDir,
  requireExpected = false,
  allowEmptyExpected = false,
  captureMode = "",
}) {
  const actual = screenshotInventory(actualDir, "actual screenshots");
  const expected = screenshotInventory(expectedDir, "expected screenshots");
  if (allowEmptyExpected && captureMode !== "all") {
    throw new Error("fresh baseline requires a complete all-mode capture");
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

export async function sanitizeVisualArtifacts({ root, output, shards }) {
  const validatedShards = Array.isArray(shards)
    ? parseCaptureShards(JSON.stringify(shards))
    : parseCaptureShards(shards);
  requireDirectory(root, "artifact root");

  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });

  const names = new Set();
  let totalBytes = 0;
  for (const shard of validatedShards) {
    const source = path.join(root, `shard-${shard}`);
    requireDirectory(source, `shard ${shard} artifact`);
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const file = path.join(source, entry.name);
      const stat = lstatSync(file);
      if (!entry.isFile() || entry.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`shard ${shard} contains a non-file artifact entry`);
      }
      if (!SAFE_SCREENSHOT.test(entry.name)) {
        throw new Error(`shard ${shard} contains a non-screenshot filename`);
      }
      if (names.has(entry.name)) throw new Error(`duplicate screenshot artifact: ${entry.name}`);
      if (stat.size < PNG_SIGNATURE.length || stat.size > MAX_FILE_BYTES) {
        throw new Error(`screenshot size is outside the allowed range: ${entry.name}`);
      }
      if (names.size >= MAX_SCREENSHOTS || totalBytes + stat.size > MAX_TOTAL_BYTES) {
        throw new Error("screenshot artifacts exceed the publisher limits");
      }
      const bytes = readFileSync(file, { encoding: null, flag: "r" });
      const canonical = await reencodePng(bytes, entry.name);
      writeFileSync(path.join(output, entry.name), canonical, { flag: "wx" });
      names.add(entry.name);
      totalBytes += canonical.length;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error("screenshot artifacts exceed the publisher limits");
      }
    }
  }
  if (names.size === 0) throw new Error("no screenshot files were found in the artifacts");
  return { count: names.size, totalBytes };
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
    });
    console.log(`visual-publish-artifacts: accepted ${result.count} PNG screenshots`);
  } catch (error) {
    console.error(`visual-publish-artifacts: ${error.message}`);
    process.exitCode = 1;
  }
}
