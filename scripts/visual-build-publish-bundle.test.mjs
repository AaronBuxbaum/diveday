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
  it("builds a sorted, gzip-compressed manifest without interpreting file contents", () => {
    const { sourceDir, bundleDir } = fixture();
    mkdirSync(path.join(sourceDir, "actual"));
    writeFileSync(
      path.join(sourceDir, "actual", "capture.png"),
      Buffer.from("png bytes are opaque to this helper"),
    );
    writeFileSync(path.join(sourceDir, "index.html"), "<main>report</main>");
    writeFileSync(path.join(sourceDir, "out.json"), '{"actualItems":["capture.png"]}');

    expect(buildVisualPublishBundle({ sourceDir, bundleDir })).toMatchObject({ count: 3 });
    const manifest = readFileSync(path.join(bundleDir, "manifest.tsv"), "utf8");
    expect(manifest).toBe(
      "actual/capture.png\timage/png\nindex.html\ttext/html\nout.json\tapplication/json\n",
    );
    expect(
      gunzipSync(
        readFileSync(path.join(bundleDir, "payload", "actual", "capture.png.gz")),
      ).toString(),
    ).toBe("png bytes are opaque to this helper");
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
});
