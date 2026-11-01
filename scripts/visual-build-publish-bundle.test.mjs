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
  it("skips unchanged actual images for pull requests and lists only what it uploads", () => {
    const { sourceDir, bundleDir } = fixture();
    for (const dir of ["actual", "expected", "diff"]) mkdirSync(path.join(sourceDir, dir));
    for (const name of ["passed.png", "changed.png"]) {
      writeFileSync(path.join(sourceDir, "actual", name), "actual");
    }
    writeFileSync(path.join(sourceDir, "expected", "changed.png"), "expected");
    const report = {
      actualDir: "actual",
      expectedDir: "expected",
      diffDir: "diff",
      actualItems: ["passed.png", "changed.png"],
      failedItems: ["changed.png"],
      deletedItems: [],
      passedItems: ["passed.png"],
    };
    writeFileSync(path.join(sourceDir, "out.json"), JSON.stringify(report));
    const result = buildVisualPublishBundle({
      sourceDir,
      bundleDir,
      publicationId: "4103-1",
      skipPassedActual: true,
    });
    const manifest = readFileSync(path.join(bundleDir, "manifest.tsv"), "utf8");
    expect(manifest).toContain("/actual/changed.png\t");
    expect(manifest).not.toContain("/actual/passed.png");
    const published = JSON.parse(
      gunzipSync(readFileSync(path.join(bundleDir, "payload", "out.json.gz"))).toString("utf8"),
    );
    expect(published.actualItems).toEqual(["changed.png"]);
    expect(published.passedItems).toEqual(["passed.png"]);
    expect(published.partialActual).toBe(true);

    const full = buildVisualPublishBundle({ sourceDir, bundleDir, publicationId: "4103-1" });
    expect(readFileSync(path.join(bundleDir, "manifest.tsv"), "utf8")).toContain(
      "/actual/passed.png\t",
    );
    expect(full.snapshotVersion).toBe(result.snapshotVersion);
  });

  it("uploads expected images only for changed and deleted items", () => {
    const { sourceDir, bundleDir } = fixture();
    for (const dir of ["actual", "expected", "diff"]) mkdirSync(path.join(sourceDir, dir));
    for (const name of ["passed.png", "changed.png", "deleted.png"]) {
      writeFileSync(path.join(sourceDir, "expected", name), "expected");
    }
    for (const name of ["passed.png", "changed.png"]) {
      writeFileSync(path.join(sourceDir, "actual", name), "actual");
    }
    writeFileSync(
      path.join(sourceDir, "out.json"),
      JSON.stringify({
        actualDir: "actual",
        expectedDir: "expected",
        diffDir: "diff",
        actualItems: ["passed.png", "changed.png"],
        failedItems: ["changed.png"],
        deletedItems: ["deleted.png"],
        passedItems: ["passed.png"],
      }),
    );
    const result = buildVisualPublishBundle({ sourceDir, bundleDir, publicationId: "4102-1" });
    const manifest = readFileSync(path.join(bundleDir, "manifest.tsv"), "utf8");
    const prefix = `snapshots/${result.snapshotVersion}`;
    expect(manifest).toContain(`${prefix}/expected/changed.png\t`);
    expect(manifest).toContain(`${prefix}/expected/deleted.png\t`);
    expect(manifest).not.toContain(`${prefix}/expected/passed.png`);
    expect(manifest).toContain(`${prefix}/actual/passed.png\t`);
  });

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

    const publicationId = "4101-1";
    const result = buildVisualPublishBundle({ sourceDir, bundleDir, publicationId });
    expect(result).toMatchObject({ count: 6, publicationId });
    expect(result.snapshotVersion).toMatch(/^[0-9a-f]{64}$/u);
    const manifest = readFileSync(path.join(bundleDir, "manifest.tsv"), "utf8");
    expect(manifest).toBe(
      `snapshots/${result.snapshotVersion}/actual/capture.png\timage/png\n` +
        `snapshots/${result.snapshotVersion}/diff/capture.png\timage/png\n` +
        `snapshots/${result.snapshotVersion}/expected/capture.png\timage/png\n` +
        `snapshots/${result.snapshotVersion}/index.html\ttext/html\n` +
        `snapshots/${result.snapshotVersion}/out.json\tapplication/json\n` +
        "out.json\tapplication/json\n",
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
      snapshotVersion: result.snapshotVersion,
      publicationId,
    });
    const localReport = JSON.parse(
      gunzipSync(
        readFileSync(
          path.join(bundleDir, "payload", "snapshots", result.snapshotVersion, "out.json.gz"),
        ),
      ).toString("utf8"),
    );
    expect(localReport).toMatchObject({
      actualDir: "actual",
      expectedDir: "expected",
      diffDir: "diff",
      snapshotVersion: result.snapshotVersion,
      publicationId,
    });

    const repeated = buildVisualPublishBundle({ sourceDir, bundleDir, publicationId });
    expect(repeated.snapshotVersion).toBe(result.snapshotVersion);
  });

  it("rejects unsafe symlinks and unsupported file types", () => {
    const linked = fixture();
    const outside = path.join(linked.root, "outside.png");
    writeFileSync(outside, "opaque");
    symlinkSync(outside, path.join(linked.sourceDir, "linked.png"));
    expect(() => buildVisualPublishBundle({ ...linked, publicationId: "4101-1" })).toThrow(
      /symlink/u,
    );

    const unsupported = fixture();
    writeFileSync(path.join(unsupported.sourceDir, "run.sh"), "echo not executable here");
    expect(() => buildVisualPublishBundle({ ...unsupported, publicationId: "4101-1" })).toThrow(
      /unsupported file type/u,
    );
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

    const result = buildVisualPublishBundle({ sourceDir, bundleDir, publicationId: "4101-1" });
    expect(result).toMatchObject({ count: 3 });
    expect(readFileSync(path.join(bundleDir, "manifest.tsv"), "utf8")).toBe(
      `snapshots/${result.snapshotVersion}/detector.wasm\tapplication/wasm\n` +
        `snapshots/${result.snapshotVersion}/out.json\tapplication/json\n` +
        "out.json\tapplication/json\n",
    );
    expect(
      gunzipSync(
        readFileSync(
          path.join(bundleDir, "payload", "snapshots", result.snapshotVersion, "detector.wasm.gz"),
        ),
      ),
    ).toEqual(detector);

    const nested = fixture();
    mkdirSync(path.join(nested.sourceDir, "assets"));
    writeFileSync(path.join(nested.sourceDir, "assets", "detector.wasm"), detector);
    expect(() => buildVisualPublishBundle({ ...nested, publicationId: "4101-1" })).toThrow(
      /unsupported file type/u,
    );
  });

  it("includes reg-suit's root worker JavaScript asset", () => {
    const { sourceDir, bundleDir } = fixture();
    writeFileSync(path.join(sourceDir, "worker.js"), "self.onmessage = () => {};");
    writeFileSync(
      path.join(sourceDir, "out.json"),
      JSON.stringify({
        actualDir: "actual",
        expectedDir: "expected",
        diffDir: "diff",
        actualItems: [],
      }),
    );

    const result = buildVisualPublishBundle({ sourceDir, bundleDir, publicationId: "4101-1" });
    expect(readFileSync(path.join(bundleDir, "manifest.tsv"), "utf8")).toContain(
      `snapshots/${result.snapshotVersion}/worker.js\tapplication/javascript\n`,
    );
    expect(
      gunzipSync(
        readFileSync(
          path.join(bundleDir, "payload", "snapshots", result.snapshotVersion, "worker.js.gz"),
        ),
      ).toString(),
    ).toBe("self.onmessage = () => {};");
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
    const firstVersion = buildVisualPublishBundle({
      ...first,
      publicationId: "4101-1",
    }).snapshotVersion;

    writeFileSync(path.join(first.sourceDir, "actual", "capture.png"), "changed capture");
    const changedVersion = buildVisualPublishBundle({
      ...first,
      publicationId: "4101-1",
    }).snapshotVersion;
    expect(changedVersion).not.toBe(firstVersion);
  });

  it("gives every same-SHA workflow attempt a fresh snapshot namespace", () => {
    const { sourceDir, bundleDir } = fixture();
    mkdirSync(path.join(sourceDir, "actual"));
    writeFileSync(path.join(sourceDir, "actual", "capture.png"), "same capture");
    writeFileSync(
      path.join(sourceDir, "out.json"),
      JSON.stringify({
        actualDir: "actual",
        expectedDir: "expected",
        diffDir: "diff",
        actualItems: ["capture.png"],
      }),
    );

    const first = buildVisualPublishBundle({ sourceDir, bundleDir, publicationId: "4101-1" });
    const retry = buildVisualPublishBundle({ sourceDir, bundleDir, publicationId: "4101-2" });
    expect(retry.snapshotVersion).not.toBe(first.snapshotVersion);

    const repeatedRetry = buildVisualPublishBundle({
      sourceDir,
      bundleDir,
      publicationId: "4101-2",
    });
    expect(repeatedRetry.snapshotVersion).toBe(retry.snapshotVersion);
  });
});
