import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXTENSION_DIR,
  extensionFiles,
  packExtension,
  packingRefusals,
  protocolVersion,
} from "./pack-extension.mjs";

const manifest = (overrides = {}) => ({
  manifest_version: 3,
  version: "1.4.0",
  host_permissions: ["https://www.naui.org/*", "https://pro.padi.com/*"],
  content_scripts: [{ matches: ["https://dive.day/shop/*"], js: ["protocol.js", "bridge.js"] }],
  ...overrides,
});
const PROTOCOL = 'const X = {\n  VERSION: "1.4.0",\n};\n';
const AGENCIES =
  'const PADI_ORIGINS = ["https://pro.padi.com", "https://pros.padi.com"];\nconst A = { naui: { url: "https://www.naui.org/services/verify/" } };\n';
const refusals = (overrides = {}) =>
  packingRefusals({
    manifest: manifest(overrides),
    protocolSource: PROTOCOL,
    agenciesSource: AGENCIES,
  });

const made = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A stand-in extension folder with a README, a store listing and a dotfile beside the code. */
function stage(files) {
  const dir = mkdtempSync(join(tmpdir(), "pack-extension-"));
  made.push(dir);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

describe("packingRefusals", () => {
  it("packs a published manifest whose version protocol.js announces", () => {
    expect(refusals()).toEqual([]);
  });

  it.each([
    "http://localhost/shop/*",
    "https://localhost/*",
    "http://127.0.0.1/*",
    "*://dive.day/shop/*",
    "http://dive.day/shop/*",
  ])("refuses the local-testing match %s", (pattern) => {
    const found = refusals({
      content_scripts: [{ matches: ["https://dive.day/shop/*", pattern], js: ["bridge.js"] }],
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(pattern);
  });

  it("refuses a localhost host permission too", () => {
    expect(
      refusals({ host_permissions: ["https://www.naui.org/*", "http://localhost/*"] }),
    ).toEqual([expect.stringContaining("is for local testing")]);
  });

  /** Security review: only the agencies the extension looks up, and only DiveDay's staff pages. */
  it.each([
    "<all_urls>",
    "https://*/*",
    "*://*/*",
    "file:///*",
    "https://localhost.example.com/*",
    "https://www.naui.org.evil.example/*",
  ])("refuses the host permission %s, which no agency's lookup is on", (pattern) => {
    const found = refusals({ host_permissions: ["https://www.naui.org/*", pattern] });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(pattern);
  });

  it.each([
    "<all_urls>",
    "https://*/*",
    "file:///*",
    "https://dive.day/*",
    "https://*.dive.day/shop/*",
  ])("refuses the content-script match %s, which is not DiveDay's staff pages", (pattern) => {
    const found = refusals({ content_scripts: [{ matches: [pattern], js: ["bridge.js"] }] });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(pattern);
  });

  it("refuses an optional host permission the same way", () => {
    expect(refusals({ optional_host_permissions: ["<all_urls>"] })).toHaveLength(1);
  });

  it("refuses a manifest version protocol.js does not announce", () => {
    expect(refusals({ version: "1.5.0" })).toEqual([
      "manifest.json is version 1.5.0 but protocol.js announces 1.4.0: bump both together.",
    ]);
    expect(
      packingRefusals({
        manifest: manifest(),
        protocolSource: "nothing",
        agenciesSource: AGENCIES,
      }),
    ).toHaveLength(1);
  });

  it("refuses anything but Manifest V3", () => {
    expect(refusals({ manifest_version: 2 })).toHaveLength(1);
  });

  it("finds nothing to refuse in the extension as committed", () => {
    expect(
      packingRefusals({
        manifest: JSON.parse(readFileSync(join(EXTENSION_DIR, "manifest.json"), "utf8")),
        protocolSource: readFileSync(join(EXTENSION_DIR, "protocol.js"), "utf8"),
        agenciesSource: readFileSync(join(EXTENSION_DIR, "agencies.js"), "utf8"),
      }),
    ).toEqual([]);
  });
});

/** A stand-in of the 1.5.0 layout: what the manifest names, what that loads, and strays beside it. */
const LAYOUT = {
  "manifest.json": JSON.stringify(
    manifest({
      icons: { 16: "icons/icon-16.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
      background: { service_worker: "background.js" },
    }),
  ),
  "background.js":
    'importScripts("protocol.js", "agencies.js", "fill.js", "shape.js");\nchrome.runtime.getURL(`sample.html#${agency}`);\n',
  "protocol.js": PROTOCOL,
  "agencies.js": AGENCIES,
  "fill.js": "// fill",
  "shape.js": "// shape",
  "bridge.js": "// bridge",
  "sample.html": '<script src="shape.js"></script>\n<script src="sample.js"></script>\n',
  "sample.js": "// sample",
  "icons/icon-16.png": "png",
  "icons/icon-48.png": "png",
  "icons/icon-128.png": "png",
  "README.md": "# readme",
  "store/listing.md": "# listing",
  "store/screenshot-1.png": "png",
  ".DS_Store": "x",
  "notes.txt": "a stray",
  "old/fill.js": "// a stray copy",
};

describe("what goes in the zip", () => {
  /** Security review: an allowlist from the manifest, not everything in the folder. */
  it("holds exactly the files the manifest names and what they load", () => {
    expect(extensionFiles(stage(LAYOUT))).toEqual({
      ok: true,
      files: [
        "agencies.js",
        "background.js",
        "bridge.js",
        "fill.js",
        "icons/icon-128.png",
        "icons/icon-16.png",
        "icons/icon-48.png",
        "manifest.json",
        "protocol.js",
        "sample.html",
        "sample.js",
        "shape.js",
      ],
    });
  });

  it("refuses a file the manifest names that is not there", () => {
    const { "shape.js": _, ...withoutShape } = LAYOUT;
    expect(extensionFiles(stage(withoutShape))).toEqual({
      ok: false,
      refusals: [expect.stringContaining("shape.js")],
    });
  });

  it("refuses a symlink, even to a file inside the folder", () => {
    const { "fill.js": _, ...rest } = LAYOUT;
    const dir = stage(rest);
    symlinkSync(join(dir, "protocol.js"), join(dir, "fill.js"));
    expect(extensionFiles(dir)).toEqual({
      ok: false,
      refusals: [expect.stringContaining("fill.js is a symlink")],
    });
  });

  it("refuses a path that leaves the folder", () => {
    const dir = stage({
      ...LAYOUT,
      "manifest.json": JSON.stringify(manifest({ icons: { 128: "../secret.png" } })),
    });
    expect(extensionFiles(dir)).toMatchObject({ ok: false });
  });

  it("holds the committed extension's code and nothing else", () => {
    const result = extensionFiles();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toContain("manifest.json");
    expect(result.files).toContain("background.js");
    expect(result.files.some((file) => file.endsWith(".md") || file.startsWith("store/"))).toBe(
      false,
    );
  });

  it("reads the version from protocol.js", () => {
    expect(protocolVersion(PROTOCOL)).toBe("1.4.0");
    expect(protocolVersion("VERSION = 1")).toBeNull();
  });
});

describe("packExtension", () => {
  const files = {
    "manifest.json": JSON.stringify(manifest()),
    "protocol.js": PROTOCOL,
    "agencies.js": AGENCIES,
    "bridge.js": "// bridge",
    "README.md": "# readme",
    "store/listing.md": "# listing",
    ".hidden": "x",
  };

  it("writes diveday-cert-check-<version>.zip with only the extension's own files", () => {
    const dir = stage(files);
    const outDir = stage({});
    const result = packExtension({ dir, outDir });
    expect(result).toMatchObject({ ok: true, version: "1.4.0" });
    if (!result.ok) return;
    expect(result.path).toBe(join(outDir, "diveday-cert-check-1.4.0.zip"));
    const zip = unzipSync(readFileSync(result.path));
    expect(Object.keys(zip).sort()).toEqual(["bridge.js", "manifest.json", "protocol.js"]);
    expect(new TextDecoder().decode(zip["bridge.js"])).toBe("// bridge");
  });

  it("writes the same bytes for the same files", () => {
    const dir = stage(files);
    const first = packExtension({ dir, outDir: stage({}) });
    const second = packExtension({ dir, outDir: stage({}) });
    if (!first.ok || !second.ok) throw new Error("expected both to pack");
    expect(readFileSync(first.path).equals(readFileSync(second.path))).toBe(true);
  });

  it("writes nothing when it refuses", () => {
    const dir = stage({
      ...files,
      "manifest.json": JSON.stringify(
        manifest({ content_scripts: [{ matches: ["http://localhost/shop/*"], js: [] }] }),
      ),
    });
    const outDir = stage({});
    const result = packExtension({ dir, outDir });
    expect(result.ok).toBe(false);
    expect(() => readFileSync(join(outDir, "diveday-cert-check-1.4.0.zip"))).toThrow();
  });
});

/** The listing's justifications are what the store reviews; a host added without one is refused there. */
describe("the store listing", () => {
  it("justifies every permission and host the manifest asks for", () => {
    const committed = JSON.parse(readFileSync(join(EXTENSION_DIR, "manifest.json"), "utf8"));
    const listing = readFileSync(join(EXTENSION_DIR, "store", "listing.md"), "utf8");
    const rows = listing.split("\n").filter((line) => line.startsWith("| "));
    for (const asked of [
      ...committed.permissions,
      ...committed.host_permissions,
      ...committed.content_scripts.flatMap((script) => script.matches),
    ]) {
      expect(
        rows.some((row) => row.includes(`\`${asked}\``)),
        asked,
      ).toBe(true);
    }
  });
});
