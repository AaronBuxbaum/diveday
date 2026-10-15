#!/usr/bin/env node
/**
 * Packs the cert-check browser extension (`extension/`) into the zip the Chrome
 * Web Store and Edge Add-ons take: `dist/diveday-cert-check-<version>.zip`.
 *
 *   node scripts/pack-extension.mjs [--out <dir>]
 *
 * It leaves out what is not the extension (the README, the store listing under
 * `store/`, any Markdown or dotfile) and refuses to pack a copy that must not
 * be published:
 *
 * - a content-script match or host permission on localhost or plain http,
 *   which `extension/README.md` adds for local testing: Chrome ignores the port
 *   in a match pattern, so a published localhost match would let any local web
 *   app drive the extension;
 * - a manifest version that differs from `VERSION` in `protocol.js`, the one
 *   DiveDay's pages read;
 * - anything but Manifest V3.
 *
 * The zip is the same bytes for the same files: every entry carries one fixed
 * time, in a fixed order. Runbook: docs/engineering/cert-check-extension-runbook.md.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const EXTENSION_DIR = join(ROOT, "extension");
export const DEFAULT_OUT_DIR = join(ROOT, "dist");
/** One time for every entry, so packing the same files twice gives the same zip. */
const ZIP_MTIME = "2026-01-01T00:00:00.000Z";

/** Whether a path inside the extension folder belongs in the published zip. */
export function isPublished(path) {
  const parts = path.split("/");
  if (parts[0] === "store") return false;
  if (parts.some((part) => part.startsWith("."))) return false;
  return !path.toLowerCase().endsWith(".md");
}

/** Every file under `dir` that is published, as forward-slash paths, sorted. */
export function extensionFiles(dir = EXTENSION_DIR) {
  const files = [];
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      const full = join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(relative(dir, full).split(sep).join("/"));
    }
  };
  walk(dir);
  return files.filter(isPublished).sort();
}

/** The version `protocol.js` announces to DiveDay's pages, or null. */
export function protocolVersion(source) {
  return source.match(/\bVERSION:\s*"([^"]+)"/)?.[1] ?? null;
}

const UNPUBLISHABLE_MATCH = /^(\*|http):\/\/|^[^:]+:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/;

/**
 * Why this copy of the extension must not be published; empty when it may.
 * @param {{ manifest: any, protocolSource: string }} input
 */
export function packingRefusals({ manifest, protocolSource }) {
  const refusals = [];
  if (manifest.manifest_version !== 3) {
    refusals.push(`manifest_version is ${manifest.manifest_version}; the stores take 3.`);
  }
  const patterns = [
    ...(manifest.host_permissions ?? []),
    ...(manifest.content_scripts ?? []).flatMap((script) => script.matches ?? []),
  ];
  for (const pattern of patterns) {
    if (UNPUBLISHABLE_MATCH.test(pattern)) {
      refusals.push(
        `${pattern} is for local testing: remove it from manifest.json before packing (extension/README.md, "Try it locally").`,
      );
    }
  }
  const announced = protocolVersion(protocolSource);
  if (announced !== manifest.version) {
    refusals.push(
      `manifest.json is version ${manifest.version} but protocol.js announces ${announced}: bump both together.`,
    );
  }
  return refusals;
}

/**
 * Pack `dir` into `<outDir>/diveday-cert-check-<version>.zip`.
 * @returns {{ ok: true, path: string, version: string, files: string[] } | { ok: false, refusals: string[] }}
 */
export function packExtension({ dir = EXTENSION_DIR, outDir = DEFAULT_OUT_DIR } = {}) {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const refusals = packingRefusals({
    manifest,
    protocolSource: readFileSync(join(dir, "protocol.js"), "utf8"),
  });
  if (refusals.length > 0) return { ok: false, refusals };
  const files = extensionFiles(dir);
  const entries = Object.fromEntries(
    files.map((file) => [file, [readFileSync(join(dir, file)), { mtime: ZIP_MTIME }]]),
  );
  const path = join(outDir, `diveday-cert-check-${manifest.version}.zip`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path, zipSync(entries, { level: 9 }));
  return { ok: true, path, version: manifest.version, files };
}

function main(argv) {
  const outAt = argv.indexOf("--out");
  const outDir = outAt >= 0 && argv[outAt + 1] ? resolve(argv[outAt + 1]) : DEFAULT_OUT_DIR;
  const result = packExtension({ outDir });
  if (!result.ok) {
    console.error("pack-extension: refused to pack extension/:");
    for (const refusal of result.refusals) console.error(`- ${refusal}`);
    return 1;
  }
  console.log(
    `pack-extension: ${relative(process.cwd(), result.path)} (version ${result.version}, ${result.files.length} files: ${result.files.join(", ")})`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
