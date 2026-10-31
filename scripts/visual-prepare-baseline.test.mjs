import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { prepareVisualBaseline } from "./visual-prepare-baseline.mjs";

const KEY = "a".repeat(40);
const BUCKET = "diveday-vrt";
const VERSION = "b".repeat(64);
let PNG;
const temps = [];

beforeAll(async () => {
  PNG = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 30, g: 80, b: 120, alpha: 1 } },
  })
    .png()
    .toBuffer();
});

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "diveday-visual-baseline-"));
  temps.push(root);
  const sourceDir = path.join(root, "cache");
  const outputDir = path.join(root, ".reg", "expected");
  mkdirSync(sourceDir);
  return { root, sourceDir, outputDir };
}

function report(actualItems, version = VERSION) {
  const root = `snapshots/${version}/`;
  return {
    actualDir: `${root}actual`,
    expectedDir: `${root}expected`,
    diffDir: `${root}diff`,
    actualItems,
  };
}

afterEach(() => {
  for (const temp of temps.splice(0)) rmSync(temp, { recursive: true, force: true });
});

describe("prepareVisualBaseline", () => {
  it("re-encodes cached baseline screenshots into the expected directory", async () => {
    const { sourceDir, outputDir } = fixture();
    const withTrailingData = Buffer.concat([PNG, Buffer.from("stale trailing bytes")]);
    writeFileSync(path.join(sourceDir, "schedule-light-vw-390.png"), withTrailingData);

    await expect(
      prepareVisualBaseline({
        bucket: BUCKET,
        key: KEY,
        version: VERSION,
        sourceDir,
        sourceKey: `reg-baseline-v2-${KEY}-${VERSION}`,
        outputDir,
      }),
    ).resolves.toMatchObject({ count: 1 });
    const canonical = readFileSync(path.join(outputDir, "schedule-light-vw-390.png"));
    expect(canonical).not.toEqual(withTrailingData);
    await expect(sharp(canonical).metadata()).resolves.toMatchObject({
      format: "png",
      width: 2,
      height: 2,
    });
  });

  it("ignores legacy print PDFs in a cached baseline", async () => {
    const { sourceDir, outputDir } = fixture();
    writeFileSync(path.join(sourceDir, "baseline.png"), PNG);
    writeFileSync(path.join(sourceDir, "trip-mixed-training-depth-manifest-print.pdf"), "%PDF");

    await expect(
      prepareVisualBaseline({
        bucket: BUCKET,
        key: KEY,
        version: VERSION,
        sourceDir,
        sourceKey: `reg-baseline-v2-${KEY}-${VERSION}`,
        outputDir,
      }),
    ).resolves.toMatchObject({ count: 1 });
    expect(existsSync(path.join(outputDir, "baseline.png"))).toBe(true);
    expect(existsSync(path.join(outputDir, "trip-mixed-training-depth-manifest-print.pdf"))).toBe(
      false,
    );
  });

  it("ignores non-PNG cache metadata with names outside the screenshot allowlist", async () => {
    const { sourceDir, outputDir } = fixture();
    writeFileSync(path.join(sourceDir, "baseline.png"), PNG);
    writeFileSync(path.join(sourceDir, ".DS_Store"), "metadata");

    await expect(
      prepareVisualBaseline({
        bucket: BUCKET,
        key: KEY,
        version: VERSION,
        sourceDir,
        sourceKey: `reg-baseline-v2-${KEY}-${VERSION}`,
        outputDir,
      }),
    ).resolves.toMatchObject({ count: 1 });
    expect(existsSync(path.join(outputDir, "baseline.png"))).toBe(true);
    expect(existsSync(path.join(outputDir, ".DS_Store"))).toBe(false);
  });

  it("rejects cached PNGs with names outside the screenshot allowlist", async () => {
    const { sourceDir, outputDir } = fixture();
    writeFileSync(path.join(sourceDir, "ñame.png"), PNG);

    await expect(
      prepareVisualBaseline({
        bucket: BUCKET,
        key: KEY,
        version: VERSION,
        sourceDir,
        sourceKey: `reg-baseline-v2-${KEY}-${VERSION}`,
        outputDir,
      }),
    ).rejects.toThrow(/unsafe filename/u);
  });

  it("fetches and validates the public S3 manifest and its named images without AWS credentials", async () => {
    const { outputDir } = fixture();
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith(`${KEY}/out.json`)) {
        return new Response(JSON.stringify(report(["baseline.png"])), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (String(url).endsWith(`${KEY}/snapshots/${VERSION}/actual/baseline.png`)) {
        return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
      }
      return new Response(null, { status: 404 });
    };

    await expect(
      prepareVisualBaseline({ bucket: BUCKET, key: KEY, version: VERSION, outputDir, fetchImpl }),
    ).resolves.toMatchObject({ count: 1 });
    expect(calls).toEqual([
      `https://${BUCKET}.s3.amazonaws.com/${KEY}/out.json`,
      `https://${BUCKET}.s3.amazonaws.com/${KEY}/snapshots/${VERSION}/actual/baseline.png`,
    ]);
    expect(readFileSync(path.join(outputDir, "baseline.png"))).not.toEqual(PNG);
  });

  it("fetches capture images from the versioned directory named by the marker", async () => {
    const { outputDir } = fixture();
    const version = "b".repeat(64);
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith(`${KEY}/out.json`)) {
        return new Response(JSON.stringify(report(["baseline.png"], version)), { status: 200 });
      }
      return String(url).endsWith(`${KEY}/snapshots/${version}/actual/baseline.png`)
        ? new Response(PNG, { status: 200 })
        : new Response(null, { status: 404 });
    };

    await expect(
      prepareVisualBaseline({ bucket: BUCKET, key: KEY, version, outputDir, fetchImpl }),
    ).resolves.toMatchObject({ count: 1 });
    expect(calls).toEqual([
      `https://${BUCKET}.s3.amazonaws.com/${KEY}/out.json`,
      `https://${BUCKET}.s3.amazonaws.com/${KEY}/snapshots/${version}/actual/baseline.png`,
    ]);
  });

  it("rejects an unversioned legacy baseline marker without fetching its images", async () => {
    const { outputDir } = fixture();
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({
          actualDir: "actual",
          expectedDir: "expected",
          diffDir: "diff",
          actualItems: ["baseline.png"],
        }),
        { status: 200 },
      );
    };

    await expect(
      prepareVisualBaseline({ bucket: BUCKET, key: KEY, version: VERSION, outputDir, fetchImpl }),
    ).rejects.toThrow(/unsafe image directories/u);
    expect(calls).toEqual([`https://${BUCKET}.s3.amazonaws.com/${KEY}/out.json`]);
  });

  it("rejects a versioned report that disagrees with the marker version", async () => {
    const { outputDir } = fixture();
    const version = "b".repeat(64);
    const fetchImpl = async (url) =>
      String(url).endsWith(`${KEY}/out.json`)
        ? new Response(JSON.stringify(report(["baseline.png"], "c".repeat(64))), { status: 200 })
        : new Response(PNG, { status: 200 });

    await expect(
      prepareVisualBaseline({ bucket: BUCKET, key: KEY, version, outputDir, fetchImpl }),
    ).rejects.toThrow(/does not match the published marker/u);
  });

  it("ignores legacy print PDFs in a fetched baseline manifest", async () => {
    const { outputDir } = fixture();
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith(`${KEY}/out.json`)) {
        return new Response(
          JSON.stringify(
            report(["baseline.png", "trip-mixed-training-depth-manifest-print-a4.pdf"]),
          ),
          { status: 200 },
        );
      }
      if (String(url).endsWith(`${KEY}/snapshots/${VERSION}/actual/baseline.png`)) {
        return new Response(PNG, { status: 200 });
      }
      return new Response(null, { status: 404 });
    };

    await expect(
      prepareVisualBaseline({ bucket: BUCKET, key: KEY, version: VERSION, outputDir, fetchImpl }),
    ).resolves.toMatchObject({ count: 1 });
    expect(calls).toEqual([
      `https://${BUCKET}.s3.amazonaws.com/${KEY}/out.json`,
      `https://${BUCKET}.s3.amazonaws.com/${KEY}/snapshots/${VERSION}/actual/baseline.png`,
    ]);
    expect(
      existsSync(path.join(outputDir, "trip-mixed-training-depth-manifest-print-a4.pdf")),
    ).toBe(false);
  });

  it("does not use a cache restored for a different baseline key", async () => {
    const { sourceDir, outputDir } = fixture();
    writeFileSync(path.join(sourceDir, "wrong-baseline.png"), PNG);
    const fetchImpl = async (url) =>
      String(url).endsWith(`${KEY}/out.json`)
        ? new Response(JSON.stringify(report(["right-baseline.png"])), {
            status: 200,
          })
        : new Response(PNG, { status: 200 });

    await expect(
      prepareVisualBaseline({
        bucket: BUCKET,
        key: KEY,
        version: VERSION,
        sourceDir,
        sourceKey: `reg-baseline-v2-${"b".repeat(40)}-${VERSION}`,
        outputDir,
        fetchImpl,
      }),
    ).resolves.toMatchObject({ count: 1 });
    expect(readFileSync(path.join(outputDir, "right-baseline.png"))).toBeInstanceOf(Buffer);
  });

  it("rejects unsafe names and malformed image payloads from the public manifest", async () => {
    const { outputDir } = fixture();
    const fetchWithReport = (report) => async (url) =>
      String(url).endsWith(`${KEY}/out.json`)
        ? new Response(JSON.stringify(report), { status: 200 })
        : new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]), {
            status: 200,
          });

    await expect(
      prepareVisualBaseline({
        bucket: BUCKET,
        key: KEY,
        version: VERSION,
        outputDir,
        fetchImpl: fetchWithReport(report(["../outside.png"])),
      }),
    ).rejects.toThrow(/unsafe screenshot name/u);

    await expect(
      prepareVisualBaseline({
        bucket: BUCKET,
        key: KEY,
        version: VERSION,
        outputDir,
        fetchImpl: fetchWithReport(report(["../outside.pdf"])),
      }),
    ).rejects.toThrow(/unsafe screenshot name/u);

    await expect(
      prepareVisualBaseline({
        bucket: BUCKET,
        key: KEY,
        version: VERSION,
        outputDir,
        fetchImpl: fetchWithReport(report(["baseline.png"])),
      }),
    ).rejects.toThrow(/PNG/u);
  });

  it("creates an empty baseline when there is no expected key", async () => {
    const { outputDir } = fixture();
    await expect(prepareVisualBaseline({ bucket: BUCKET, outputDir })).resolves.toMatchObject({
      count: 0,
    });
  });
});
