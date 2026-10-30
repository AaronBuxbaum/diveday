import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { buildVisualPublishBundle } from "./visual-build-publish-bundle.mjs";

const temps = [];

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "diveday-visual-bundle-"));
  temps.push(root);
  const sourceDir = path.join(root, ".reg");
  const bundleDir = path.join(root, "bundle");
  mkdirSync(sourceDir);
  return { root, sourceDir, bundleDir };
}

afterEach(() => {
  for (const temp of temps.splice(0)) rmSync(temp, { recursive: true, force: true });
});

describe("buildVisualPublishBundle", () => {
  it("builds deterministic snapshot versions and rewrites report paths before publication", () => {
    const { sourceDir, bundleDir } = fixture();
    mkdirSync(path.join(sourceDir, "actual"));
    mkdirSync(path.join(sourceDir, "expected"));
    mkdirSync(path.join(sourceDir, "diff"));
    writeFileSync(
      path.join(sourceDir, "actual", "capture.png"),
      Buffer.from("png bytes are opaque to this helper"),
    );
    writeFileSync(path.join(sourceDir, "expected", "capture.png"), "expected bytes");
    writeFileSync(path.join(sourceDir, "diff", "capture.png"), "diff bytes");
    writeFileSync(path.join(sourceDir, "index.html"), "<main>report</main>");
    writeFileSync(
      path.join(sourceDir, "out.json"),
      JSON.stringify({
        actualDir: "actual",
        expectedDir: "expected",
        diffDir: "diff",
        actualItems: ["capture.png"],
      }),
    );

    const result = buildVisualPublishBundle({ sourceDir, bundleDir });
    expect(result).toMatchObject({ count: 5 });
    expect(result.snapshotVersion).toMatch(/^[0-9a-f]{64}$/u);
    const manifest = readFileSync(path.join(bundleDir, "manifest.tsv"), "utf8");
    expect(manifest).toBe(
      `snapshots/${result.snapshotVersion}/actual/capture.png\timage/png\n` +
        `snapshots/${result.snapshotVersion}/diff/capture.png\timage/png\n` +
        `snapshots/${result.snapshotVersion}/expected/capture.png\timage/png\n` +
        "index.html\ttext/html\nout.json\tapplication/json\n",
    );
    expect(
      gunzipSync(
        readFileSync(
          path.join(
            bundleDir,
            "payload",
            "snapshots",
            result.snapshotVersion,
            "actual",
            "capture.png.gz",
          ),
        ),
      ).toString(),
    ).toBe("png bytes are opaque to this helper");
    const publishedReport = JSON.parse(
      gunzipSync(readFileSync(path.join(bundleDir, "payload", "out.json.gz"))).toString("utf8"),
    );
    expect(publishedReport).toMatchObject({
      actualDir: `snapshots/${result.snapshotVersion}/actual`,
      expectedDir: `snapshots/${result.snapshotVersion}/expected`,
      diffDir: `snapshots/${result.snapshotVersion}/diff`,
    });

    const repeated = buildVisualPublishBundle({ sourceDir, bundleDir });
    expect(repeated.snapshotVersion).toBe(result.snapshotVersion);
  });

  it("rejects unsafe symlinks and unsupported file types", () => {
    const linked = fixture();
    const outside = path.join(linked.root, "outside.png");
    writeFileSync(outside, "opaque");
    symlinkSync(outside, path.join(linked.sourceDir, "linked.png"));
    expect(() => buildVisualPublishBundle(linked)).toThrow(/symlink/u);

    const unsupported = fixture();
    writeFileSync(path.join(unsupported.sourceDir, "run.sh"), "echo not executable here");
    expect(() => buildVisualPublishBundle(unsupported)).toThrow(/unsupported file type/u);
  });

  it("includes only reg-suit's root browser detector WebAssembly asset", () => {
    const { sourceDir, bundleDir } = fixture();
    const detector = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
    writeFileSync(path.join(sourceDir, "detector.wasm"), detector);
    writeFileSync(
      path.join(sourceDir, "out.json"),
      JSON.stringify({
        actualDir: "actual",
        expectedDir: "expected",
        diffDir: "diff",
        actualItems: [],
      }),
    );

    const result = buildVisualPublishBundle({ sourceDir, bundleDir });
    expect(result).toMatchObject({ count: 2 });
    expect(readFileSync(path.join(bundleDir, "manifest.tsv"), "utf8")).toBe(
      "detector.wasm\tapplication/wasm\nout.json\tapplication/json\n",
    );
    expect(gunzipSync(readFileSync(path.join(bundleDir, "payload", "detector.wasm.gz")))).toEqual(
      detector,
    );

    const nested = fixture();
    mkdirSync(path.join(nested.sourceDir, "assets"));
    writeFileSync(path.join(nested.sourceDir, "assets", "detector.wasm"), detector);
    expect(() => buildVisualPublishBundle(nested)).toThrow(/unsupported file type/u);
  });

  it("changes the version when any published capture changes", () => {
    const first = fixture();
    mkdirSync(path.join(first.sourceDir, "actual"));
    writeFileSync(path.join(first.sourceDir, "actual", "capture.png"), "first capture");
    writeFileSync(
      path.join(first.sourceDir, "out.json"),
      JSON.stringify({
        actualDir: "actual",
        expectedDir: "expected",
        diffDir: "diff",
        actualItems: ["capture.png"],
      }),
    );
    const firstVersion = buildVisualPublishBundle(first).snapshotVersion;

    writeFileSync(path.join(first.sourceDir, "actual", "capture.png"), "changed capture");
    const changedVersion = buildVisualPublishBundle(first).snapshotVersion;
    expect(changedVersion).not.toBe(firstVersion);
  });
});
