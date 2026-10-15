#!/usr/bin/env node
/**
 * Packs the cert-check browser extension (`extension/`) into the zip the Chrome
 * Web Store and Edge Add-ons take: `dist/diveday-cert-check-<version>.zip`.
 *
 *   node scripts/pack-extension.mjs [--out <dir>]
 *
 * It packs **only the files the manifest names and what they load**: the
 * manifest, its service worker and the scripts that `importScripts`, its
 * content scripts, its icons, and the extension's own pages the service worker
 * opens (`chrome.runtime.getURL("sample.html")`) with the scripts and styles
 * they load. Nothing else in the folder (the README, `store/`, a stray copy)
 * is packed. It refuses to pack a copy that must not be published:
 *
 * - a file the manifest names that is missing, is a symlink, or lies outside
 *   the folder;
 * - a content-script match or host permission on localhost or plain http,
 *   which `extension/README.md` adds for local testing: Chrome ignores the port
 *   in a match pattern, so a published localhost match would let any local web
 *   app drive the extension;
 * - a host permission for any site but the agencies' lookup origins in
 *   `agencies.js` (`<all_urls>`, `https://*` and `file://` included), and a
 *   content script anywhere but `https://dive.day/shop/*`;
 * - a manifest version that differs from `VERSION` in `protocol.js`, the one
 *   DiveDay's pages read;
 * - anything but Manifest V3.
 *
 * The zip is the same bytes for the same files: every entry carries one fixed
 * time, in a fixed order. Runbook: docs/engineering/cert-check-extension-runbook.md.
 */
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const EXTENSION_DIR = join(ROOT, "extension");
export const DEFAULT_OUT_DIR = join(ROOT, "dist");
/** One time for every entry, so packing the same files twice gives the same zip. */
const ZIP_MTIME = "2026-01-01T00:00:00.000Z";

/** The one place DiveDay's content script may run. */
export const STAFF_PAGES_MATCH = "https://dive.day/shop/*";

/** The paths a manifest names directly: itself, its service worker, content scripts and icons. */
function manifestPaths(manifest) {
  const icons = (value) =>
    typeof value === "string"
      ? [value]
      : Object.values(value ?? {}).filter((v) => typeof v === "string");
  return [
    "manifest.json",
    ...(manifest.background?.service_worker ? [manifest.background.service_worker] : []),
    ...(manifest.content_scripts ?? []).flatMap((script) => [
      ...(script.js ?? []),
      ...(script.css ?? []),
    ]),
    ...icons(manifest.icons),
    ...icons(manifest.action?.default_icon),
  ];
}

/** What a script loads: its `importScripts` and the extension pages it opens by `getURL`. */
function scriptLoads(source) {
  const loads = [];
  for (const call of source.matchAll(/\bimportScripts\(([^)]*)\)/g)) {
    for (const arg of (call[1] ?? "").matchAll(/["'`]([^"'`]+)["'`]/g)) loads.push(arg[1]);
  }
  for (const page of source.matchAll(/\bgetURL\(\s*["'`]([^"'`#?$]+)/g)) loads.push(page[1]);
  return loads;
}

/** What a page loads: its scripts' `src` and its stylesheets' `href`, relative ones only. */
function pageLoads(source) {
  return [...source.matchAll(/<(?:script\b[^>]*\bsrc|link\b[^>]*\bhref)\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .filter((path) => !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(path));
}

/**
 * **The files the published zip holds**: the manifest's own, and what each of
 * them loads, followed until nothing new turns up. Forward-slash paths,
 * sorted; or why the copy cannot be packed.
 * @returns {{ ok: true, files: string[] } | { ok: false, refusals: string[] }}
 */
export function extensionFiles(dir = EXTENSION_DIR) {
  const refusals = [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  } catch {
    return { ok: false, refusals: ["manifest.json is missing or is not JSON."] };
  }
  const files = new Set();
  const seen = new Set();
  const queue = manifestPaths(manifest).map((path) => ({ path, from: "manifest.json" }));
  while (queue.length > 0) {
    const { path: named, from } = queue.shift();
    const base = from === "manifest.json" ? "" : posix.dirname(from);
    const path = posix.normalize(posix.join(base, named.replace(/^\//, "")));
    if (path.startsWith("../") || path === ".." || posix.isAbsolute(path)) {
      refusals.push(`${named}, named by ${from}, lies outside extension/.`);
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    let stat;
    try {
      stat = lstatSync(join(dir, path));
    } catch {
      refusals.push(`${path}, named by ${from}, is missing.`);
      continue;
    }
    if (stat.isSymbolicLink()) {
      refusals.push(`${path} is a symlink: pack the file itself.`);
      continue;
    }
    if (!stat.isFile()) {
      refusals.push(`${path}, named by ${from}, is not a file.`);
      continue;
    }
    files.add(path);
    const source = /\.(js|html?)$/i.test(path) ? readFileSync(join(dir, path), "utf8") : "";
    const loads = /\.html?$/i.test(path) ? pageLoads(source) : scriptLoads(source);
    for (const load of loads) queue.push({ path: load, from: path });
  }
  if (refusals.length > 0) return { ok: false, refusals };
  return { ok: true, files: [...files].sort() };
}

/** The origins `agencies.js` looks up, as `https://host/*` host permissions. */
export function agencyHostPermissions(agenciesSource) {
  return new Set(
    [...agenciesSource.matchAll(/["'`](https:\/\/[a-z0-9.-]+)(?=[/"'`])/gi)].map(
      (m) => `${m[1].toLowerCase()}/*`,
    ),
  );
}

/** The version `protocol.js` announces to DiveDay's pages, or null. */
export function protocolVersion(source) {
  return source.match(/\bVERSION:\s*"([^"]+)"/)?.[1] ?? null;
}

const UNPUBLISHABLE_MATCH = /^(\*|http):\/\/|^[^:]+:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/;

/**
 * Why this copy of the extension must not be published; empty when it may.
 * @param {{ manifest: any, protocolSource: string, agenciesSource: string }} input
 */
export function packingRefusals({ manifest, protocolSource, agenciesSource }) {
  const refusals = [];
  if (manifest.manifest_version !== 3) {
    refusals.push(`manifest_version is ${manifest.manifest_version}; the stores take 3.`);
  }
  const agencyHosts = agencyHostPermissions(agenciesSource);
  const patterns = [
    ...[...(manifest.host_permissions ?? []), ...(manifest.optional_host_permissions ?? [])].map(
      (pattern) => ({ pattern, allowed: agencyHosts.has(pattern), where: "an agency's lookup" }),
    ),
    ...(manifest.content_scripts ?? [])
      .flatMap((script) => script.matches ?? [])
      .map((pattern) => ({
        pattern,
        allowed: pattern === STAFF_PAGES_MATCH,
        where: `DiveDay's staff pages (${STAFF_PAGES_MATCH})`,
      })),
  ];
  for (const { pattern, allowed, where } of patterns) {
    if (UNPUBLISHABLE_MATCH.test(pattern)) {
      refusals.push(
        `${pattern} is for local testing: remove it from manifest.json before packing (extension/README.md, "Try it locally").`,
      );
    } else if (!allowed) {
      refusals.push(`${pattern} is not ${where}: the published extension asks for nothing else.`);
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
    agenciesSource: readFileSync(join(dir, "agencies.js"), "utf8"),
  });
  if (refusals.length > 0) return { ok: false, refusals };
  const listed = extensionFiles(dir);
  if (!listed.ok) return listed;
  const { files } = listed;
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
