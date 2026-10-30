#!/usr/bin/env node
// Create a fixed, precompressed file bundle for the OIDC-only S3 publisher.
// Inputs are reg-suit output from trusted main code; this helper never decodes
// images.
import { createHash } from "node:crypto";
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 100_000_000;
const MAX_TOTAL_BYTES = 8_000_000_000;
const SNAPSHOT_DIRS = new Set(["actual", "expected", "diff"]);
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,259}$/u;
const CONTENT_TYPES = new Map([
  [".css", "text/css"],
  [".gif", "image/gif"],
  [".html", "text/html"],
  [".ico", "image/x-icon"],
  [".js", "application/javascript"],
  [".json", "application/json"],
  [".map", "application/json"],
  [".otf", "font/otf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".text", "text/plain"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function requireDirectory(directory, label) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
}

function safeRelativePath(relativePath) {
  return (
    SAFE_PATH.test(relativePath) &&
    !relativePath.includes("\\") &&
    relativePath.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function collectFiles(root, directory = root, collected = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    const stat = lstatSync(absolute);
    if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
      throw new Error("reg-suit output contains a symlink");
    }
    if (entry.isDirectory() && stat.isDirectory()) {
      collectFiles(root, absolute, collected);
      continue;
    }
    if (!entry.isFile() || !stat.isFile())
      throw new Error("reg-suit output contains a non-file entry");
    if (!safeRelativePath(relative)) {
      throw new Error(`reg-suit output has an unsafe path: ${relative}`);
    }
    const contentType =
      relative === "detector.wasm"
        ? "application/wasm"
        : CONTENT_TYPES.get(path.extname(relative).toLowerCase());
    if (!contentType) throw new Error(`reg-suit output has an unsupported file type: ${relative}`);
    if (stat.size > MAX_FILE_BYTES)
      throw new Error(`reg-suit output file is too large: ${relative}`);
    if (collected.length >= MAX_FILES) throw new Error("reg-suit output contains too many files");
    collected.push({ absolute, path: relative, contentType, size: stat.size });
  }
  return collected;
}

function snapshotPath(filePath, snapshotVersion) {
  const [directory] = filePath.split("/");
  return SNAPSHOT_DIRS.has(directory) ? `snapshots/${snapshotVersion}/${filePath}` : filePath;
}

function readReport(file) {
  let report;
  try {
    report = JSON.parse(readFileSync(file.absolute, "utf8"));
  } catch {
    throw new Error("reg-suit output has an invalid out.json report");
  }
  if (
    !report ||
    typeof report !== "object" ||
    Array.isArray(report) ||
    report.actualDir !== "actual" ||
    report.expectedDir !== "expected" ||
    report.diffDir !== "diff" ||
    !Array.isArray(report.actualItems)
  ) {
    throw new Error("reg-suit output has an unexpected out.json shape");
  }
  return report;
}

/** Build a deterministic versioned image bundle and a validated TSV manifest. */
export function buildVisualPublishBundle({ sourceDir, bundleDir }) {
  if (!sourceDir || !bundleDir) throw new Error("sourceDir and bundleDir are required");
  requireDirectory(sourceDir, "reg-suit output");
  const files = collectFiles(sourceDir).sort((a, b) => a.path.localeCompare(b.path));
  if (files.length === 0) throw new Error("reg-suit output is empty");
  const reportFile = files.find((file) => file.path === "out.json");
  if (!reportFile) throw new Error("reg-suit output has no out.json report");

  let totalBytes = 0;
  const snapshotInput = createHash("sha256");
  for (const file of files) {
    const bytes = readFileSync(file.absolute);
    snapshotInput.update(
      `${file.path}\t${file.contentType}\t${bytes.length}\t${createHash("sha256").update(bytes).digest("hex")}\n`,
    );
  }
  const snapshotVersion = snapshotInput.digest("hex");
  const report = readReport(reportFile);
  report.actualDir = `snapshots/${snapshotVersion}/actual`;
  report.expectedDir = `snapshots/${snapshotVersion}/expected`;
  report.diffDir = `snapshots/${snapshotVersion}/diff`;

  rmSync(bundleDir, { recursive: true, force: true });
  const manifest = [];
  for (const file of files) {
    const publishPath = snapshotPath(file.path, snapshotVersion);
    const bytes =
      file.path === "out.json" ? Buffer.from(JSON.stringify(report)) : readFileSync(file.absolute);
    totalBytes += bytes.length;
    if (bytes.length > MAX_FILE_BYTES) {
      throw new Error(`reg-suit output file is too large: ${file.path}`);
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("reg-suit output exceeds the publisher limits");
    }
    const output = path.join(bundleDir, "payload", `${publishPath}.gz`);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, gzipSync(bytes, { level: 9, mtime: 0 }), {
      flag: "wx",
    });
    manifest.push(`${publishPath}\t${file.contentType}`);
  }
  writeFileSync(path.join(bundleDir, "manifest.tsv"), `${manifest.join("\n")}\n`, { flag: "wx" });
  return { count: files.length, totalBytes, snapshotVersion };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = buildVisualPublishBundle({
      sourceDir: path.resolve(process.env.VISUAL_PUBLISH_SOURCE ?? ".reg"),
      bundleDir: path.resolve(process.env.VISUAL_PUBLISH_BUNDLE ?? ".reg-publish-bundle"),
    });
    console.log(
      `visual-build-publish-bundle: prepared ${result.count} files (${result.totalBytes} bytes) for snapshot ${result.snapshotVersion}`,
    );
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `snapshot_version=${result.snapshotVersion}\n`);
    }
  } catch (error) {
    console.error(`visual-build-publish-bundle: ${error.message}`);
    process.exitCode = 1;
  }
}
