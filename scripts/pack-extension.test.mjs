import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXTENSION_DIR,
  extensionFiles,
  isPublished,
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
    expect(packingRefusals({ manifest: manifest(), protocolSource: PROTOCOL })).toEqual([]);
  });

  it.each([
    "http://localhost/shop/*",
    "https://localhost/*",
    "http://127.0.0.1/*",
    "*://dive.day/shop/*",
    "http://dive.day/shop/*",
  ])("refuses the local-testing match %s", (pattern) => {
    const withMatch = manifest({
      content_scripts: [{ matches: ["https://dive.day/shop/*", pattern], js: ["bridge.js"] }],
    });
    const refusals = packingRefusals({ manifest: withMatch, protocolSource: PROTOCOL });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain(pattern);
  });

  it("refuses a localhost host permission too", () => {
    const withHost = manifest({
      host_permissions: ["https://www.naui.org/*", "http://localhost/*"],
    });
    expect(packingRefusals({ manifest: withHost, protocolSource: PROTOCOL })).toHaveLength(1);
  });

  it("leaves alone a host that only starts like localhost", () => {
    const lookalike = manifest({ host_permissions: ["https://localhost.example.com/*"] });
    expect(packingRefusals({ manifest: lookalike, protocolSource: PROTOCOL })).toEqual([]);
  });

  it("refuses a manifest version protocol.js does not announce", () => {
    expect(
      packingRefusals({ manifest: manifest({ version: "1.5.0" }), protocolSource: PROTOCOL }),
    ).toEqual([
      "manifest.json is version 1.5.0 but protocol.js announces 1.4.0: bump both together.",
    ]);
    expect(packingRefusals({ manifest: manifest(), protocolSource: "nothing" })).toHaveLength(1);
  });

  it("refuses anything but Manifest V3", () => {
    expect(
      packingRefusals({ manifest: manifest({ manifest_version: 2 }), protocolSource: PROTOCOL }),
    ).toHaveLength(1);
  });

  it("finds nothing to refuse in the extension as committed", () => {
    expect(
      packingRefusals({
        manifest: JSON.parse(readFileSync(join(EXTENSION_DIR, "manifest.json"), "utf8")),
        protocolSource: readFileSync(join(EXTENSION_DIR, "protocol.js"), "utf8"),
      }),
    ).toEqual([]);
  });
});

describe("what goes in the zip", () => {
  it.each([
    ["manifest.json", true],
    ["fill.js", true],
    ["icons/128.png", true],
    ["README.md", false],
    ["store/listing.md", false],
    ["store/screenshot-1.png", false],
    [".DS_Store", false],
    ["notes/plan.MD", false],
  ])("%s is published: %s", (path, published) => {
    expect(isPublished(path)).toBe(published);
  });

  it("holds the committed extension's code and nothing else", () => {
    const files = extensionFiles();
    expect(files).toContain("manifest.json");
    expect(files).toContain("background.js");
    expect(files.some((file) => file.endsWith(".md") || file.startsWith("store/"))).toBe(false);
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
