#!/usr/bin/env node
// Create a fixed, precompressed file bundle for the OIDC-only S3 publisher.
// Inputs are reg-suit output from trusted main code; this helper never decodes
// images.
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 100_000_000;
const MAX_TOTAL_BYTES = 8_000_000_000;
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

/** Build gzip objects and a validated TSV manifest for the credential-bearing job. */
export function buildVisualPublishBundle({ sourceDir, bundleDir }) {
  if (!sourceDir || !bundleDir) throw new Error("sourceDir and bundleDir are required");
  requireDirectory(sourceDir, "reg-suit output");
  const files = collectFiles(sourceDir).sort((a, b) => a.path.localeCompare(b.path));
  if (files.length === 0) throw new Error("reg-suit output is empty");

  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_BYTES)
      throw new Error("reg-suit output exceeds the publisher limits");
  }

  rmSync(bundleDir, { recursive: true, force: true });
  const manifest = [];
  for (const file of files) {
    const output = path.join(bundleDir, "payload", `${file.path}.gz`);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, gzipSync(readFileSync(file.absolute), { level: 9, mtime: 0 }), {
      flag: "wx",
    });
    manifest.push(`${file.path}\t${file.contentType}`);
  }
  writeFileSync(path.join(bundleDir, "manifest.tsv"), `${manifest.join("\n")}\n`, { flag: "wx" });
  return { count: files.length, totalBytes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = buildVisualPublishBundle({
      sourceDir: path.resolve(process.env.VISUAL_PUBLISH_SOURCE ?? ".reg"),
      bundleDir: path.resolve(process.env.VISUAL_PUBLISH_BUNDLE ?? ".reg-publish-bundle"),
    });
    console.log(
      `visual-build-publish-bundle: prepared ${result.count} files (${result.totalBytes} bytes)`,
    );
  } catch (error) {
    console.error(`visual-build-publish-bundle: ${error.message}`);
    process.exitCode = 1;
  }
}
