import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectOfflineShellAssets, normalizeAsset } from "./offline-shell-assets.mjs";

let dist;
beforeEach(() => {
  dist = mkdtempSync(path.join(tmpdir(), "dist-"));
});
afterEach(() => rmSync(dist, { recursive: true, force: true }));

function touch(rel) {
  const file = path.join(dist, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "x");
}

/** A fixture shaped like `next build` output for one App Router page. */
function build({ manifest, buildManifest, files }) {
  for (const f of files) touch(f);
  const dir = "server/app/offline-manifest";
  mkdirSync(path.join(dist, dir), { recursive: true });
  writeFileSync(
    path.join(dist, dir, "page_client-reference-manifest.js"),
    manifest === null
      ? ""
      : `globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST["/offline-manifest/page"]=${JSON.stringify(manifest)}`,
  );
  writeFileSync(path.join(dist, "build-manifest.json"), JSON.stringify(buildManifest));
}

const GOOD = {
  manifest: {
    entryJSFiles: {
      "[project]/src/app/layout": ["static/chunks/layout.js"],
      "[project]/src/app/offline-manifest/page": [
        "static/chunks/page.js",
        "static/chunks/shared.js",
      ],
    },
    entryCSSFiles: { "[project]/src/app/layout": [{ path: "static/css/app.css", inlined: false }] },
    clientModules: {
      "a#b": { id: 1, chunks: ["static/chunks/lazy-es.js", "7:static/chunks/shared.js"] },
    },
  },
  buildManifest: {
    rootMainFiles: ["static/chunks/main-app.js"],
    polyfillFiles: ["static/chunks/poly.js"],
  },
  files: [
    "static/chunks/layout.js",
    "static/chunks/page.js",
    "static/chunks/shared.js",
    "static/css/app.css",
    "static/chunks/lazy-es.js",
    "static/chunks/main-app.js",
    "static/chunks/poly.js",
  ],
};

describe("normalizeAsset", () => {
  it.each([
    ["static/chunks/a.js", "/_next/static/chunks/a.js"],
    ["/_next/static/chunks/a.css?v=1", "/_next/static/chunks/a.css"],
    ["12:static/chunks/a.js", "/_next/static/chunks/a.js"],
    ["static/media/font.woff2", null],
    ["12", null],
    [undefined, null],
  ])("%s", (input, expected) => expect(normalizeAsset(input)).toBe(expected));
});

describe("collectOfflineShellAssets", () => {
  it("unions the page, layout, css, lazy client-module and root chunks, sorted and unique", () => {
    build(GOOD);
    expect(collectOfflineShellAssets(dist)).toEqual([
      "/_next/static/chunks/layout.js",
      "/_next/static/chunks/lazy-es.js",
      "/_next/static/chunks/main-app.js",
      "/_next/static/chunks/page.js",
      "/_next/static/chunks/poly.js",
      "/_next/static/chunks/shared.js",
      "/_next/static/css/app.css",
    ]);
  });

  it("fails when the route manifest is missing", () => {
    expect(() => collectOfflineShellAssets(dist)).toThrow(/is missing/);
  });

  it("fails when the manifest has no entry for the shell route", () => {
    build({ ...GOOD, manifest: null });
    expect(() => collectOfflineShellAssets(dist)).toThrow(/no manifest entry/);
  });

  it("fails when the shell route's own page has no chunks", () => {
    build({
      ...GOOD,
      manifest: {
        ...GOOD.manifest,
        entryJSFiles: { "[project]/src/app/layout": ["static/chunks/layout.js"] },
      },
    });
    expect(() => collectOfflineShellAssets(dist)).toThrow(/no page chunks/);
  });

  it("fails when the build lists no root files", () => {
    build({ ...GOOD, buildManifest: { rootMainFiles: [] } });
    expect(() => collectOfflineShellAssets(dist)).toThrow(/rootMainFiles/);
  });

  it("fails when a listed chunk is not on disk", () => {
    build({ ...GOOD, files: GOOD.files.filter((f) => f !== "static/chunks/lazy-es.js") });
    expect(() => collectOfflineShellAssets(dist)).toThrow(
      /lazy-es\.js is listed by the build but not on disk/,
    );
  });
});
