import { createHash } from "node:crypto";
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
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 30, g: 80, b: 120, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
});

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "diveday-visual-baseline-"));
  temps.push(root);
  const actualDir = path.join(root, "screenshots");
  const outputDir = path.join(root, ".reg", "expected");
  const planFile = path.join(root, "plan.json");
  mkdirSync(actualDir);
  return { root, actualDir, outputDir, planFile };
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
  it("reads a main snapshot's images from the content-addressed blobs its report names", async () => {
    const { outputDir } = fixture();
    const hash = "c".repeat(64);
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith(`${KEY}/out.json`)) {
        return new Response(
          JSON.stringify({
            ...report(["a.png", "b.png"]),
            actualBlobs: { "a.png": hash, "b.png": hash },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (String(url).endsWith(`/blobs/${hash}.png`)) {
        return new Response(PNG, {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      return new Response(null, { status: 404 });
    };

    await expect(
      prepareVisualBaseline({
        bucket: BUCKET,
        key: KEY,
        version: VERSION,
        outputDir,
        fetchImpl,
      }),
    ).resolves.toMatchObject({ count: 2 });
    expect(calls.filter((url) => url.includes("/blobs/"))).toHaveLength(2);
    expect(calls.some((url) => url.includes("/actual/"))).toBe(false);
  });

  it("refuses a report whose blob hash is not a sha-256", async () => {
    const { outputDir } = fixture();
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          ...report(["a.png"]),
          actualBlobs: { "a.png": "../../etc/passwd" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    await expect(
      prepareVisualBaseline({
        bucket: BUCKET,
        key: KEY,
        version: VERSION,
        outputDir,
        fetchImpl,
      }),
    ).rejects.toThrow(/invalid image hash/u);
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
        return new Response(PNG, {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      return new Response(null, { status: 404 });
    };

    await expect(
      prepareVisualBaseline({
        bucket: BUCKET,
        key: KEY,
        version: VERSION,
        outputDir,
        fetchImpl,
      }),
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
        return new Response(JSON.stringify(report(["baseline.png"], version)), {
          status: 200,
        });
      }
      return String(url).endsWith(`${KEY}/snapshots/${version}/actual/baseline.png`)
        ? new Response(PNG, { status: 200 })
        : new Response(null, { status: 404 });
    };

    await expect(
      prepareVisualBaseline({
        bucket: BUCKET,
        key: KEY,
        version,
        outputDir,
        fetchImpl,
      }),
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
      prepareVisualBaseline({
        bucket: BUCKET,
        key: KEY,
        version: VERSION,
        outputDir,
        fetchImpl,
      }),
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
      prepareVisualBaseline({
        bucket: BUCKET,
        key: KEY,
        version,
        outputDir,
        fetchImpl,
      }),
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
      prepareVisualBaseline({
        bucket: BUCKET,
        key: KEY,
        version: VERSION,
        outputDir,
        fetchImpl,
      }),
    ).resolves.toMatchObject({ count: 1 });
    expect(calls).toEqual([
      `https://${BUCKET}.s3.amazonaws.com/${KEY}/out.json`,
      `https://${BUCKET}.s3.amazonaws.com/${KEY}/snapshots/${VERSION}/actual/baseline.png`,
    ]);
    expect(
      existsSync(path.join(outputDir, "trip-mixed-training-depth-manifest-print-a4.pdf")),
    ).toBe(false);
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

  describe("with this run's captures to hash against main's manifest", () => {
    const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
    const manifestFetch =
      (blobs, calls = []) =>
      async (url) => {
        calls.push(String(url));
        if (String(url).endsWith(`${KEY}/out.json`)) {
          return new Response(
            JSON.stringify({ ...report(Object.keys(blobs)), actualBlobs: blobs }),
            { status: 200 },
          );
        }
        return String(url).includes("/blobs/")
          ? new Response(PNG, { status: 200 })
          : new Response(null, { status: 404 });
      };

    it("fetches only the captures whose bytes differ from the manifest's hash", async () => {
      const { actualDir, outputDir, planFile } = fixture();
      const same = Buffer.from("same-bytes");
      const moved = Buffer.from("moved-bytes");
      writeFileSync(path.join(actualDir, "same.png"), same);
      writeFileSync(path.join(actualDir, "moved.png"), moved);
      writeFileSync(path.join(actualDir, "new.png"), moved);
      const calls = [];
      const movedHash = "d".repeat(64);

      const result = await prepareVisualBaseline({
        bucket: BUCKET,
        key: KEY,
        version: VERSION,
        actualDir,
        outputDir,
        planFile,
        fetchImpl: manifestFetch({ "same.png": sha(same), "moved.png": movedHash }, calls),
      });

      expect(result.count).toBe(1);
      expect(calls.filter((url) => url.includes("/blobs/"))).toEqual([
        `https://${BUCKET}.s3.amazonaws.com/blobs/${movedHash}.png`,
      ]);
      expect(existsSync(path.join(outputDir, "moved.png"))).toBe(true);
      expect(existsSync(path.join(outputDir, "same.png"))).toBe(false);
      expect(JSON.parse(readFileSync(planFile, "utf8"))).toMatchObject({
        unchanged: ["same.png"],
        filled: [],
        fetch: ["moved.png"],
      });
    });

    it("never fetches what a selective run did not capture, and fetches it on a full one", async () => {
      const blobs = { "kept.png": "e".repeat(64), "other.png": "f".repeat(64) };
      for (const [selective, fetched, filled] of [
        [true, [], ["other.png"]],
        [false, ["other.png"], []],
      ]) {
        const { actualDir, outputDir, planFile } = fixture();
        writeFileSync(path.join(actualDir, "kept.png"), "kept");
        const calls = [];
        await prepareVisualBaseline({
          bucket: BUCKET,
          key: KEY,
          version: VERSION,
          actualDir,
          selective,
          outputDir,
          planFile,
          fetchImpl: manifestFetch(blobs, calls),
        });
        const plan = JSON.parse(readFileSync(planFile, "utf8"));
        expect(plan.filled).toEqual(filled);
        expect(plan.fetch.filter((name) => name !== "kept.png")).toEqual(fetched);
      }
    });

    it("leaves no plan behind when the manifest has no hashes", async () => {
      const { actualDir, outputDir, planFile } = fixture();
      writeFileSync(planFile, "{}");
      writeFileSync(path.join(actualDir, "baseline.png"), "x");
      const fetchImpl = async (url) =>
        String(url).endsWith(`${KEY}/out.json`)
          ? new Response(JSON.stringify(report(["baseline.png"])), { status: 200 })
          : new Response(PNG, { status: 200 });

      await expect(
        prepareVisualBaseline({
          bucket: BUCKET,
          key: KEY,
          version: VERSION,
          actualDir,
          outputDir,
          planFile,
          fetchImpl,
        }),
      ).resolves.toMatchObject({ count: 1, plan: null });
      expect(existsSync(planFile)).toBe(false);
    });
  });

  it("creates an empty baseline when there is no expected key", async () => {
    const { outputDir } = fixture();
    await expect(prepareVisualBaseline({ bucket: BUCKET, outputDir })).resolves.toMatchObject({
      count: 0,
    });
  });
});
