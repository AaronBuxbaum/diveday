import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  parseCaptureShards,
  reencodePng,
  sanitizeVisualArtifacts,
  validateCaptureSelection,
  verifyCompleteScreenshotInventory,
} from "./visual-publish-artifacts.mjs";

let PNG;
const temps = [];
const ALL_SHARDS = [1, 2, 3, 4, 5, 6, 7, 8];

beforeAll(async () => {
  PNG = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 30, g: 80, b: 120, alpha: 1 } },
  })
    .png()
    .toBuffer();
});

function fixture() {
  const temp = mkdtempSync(path.join(os.tmpdir(), "diveday-visual-artifacts-"));
  temps.push(temp);
  const root = path.join(temp, "artifacts");
  mkdirSync(root);
  for (const shard of ALL_SHARDS) mkdirSync(path.join(root, `shard-${shard}`));
  return { temp, root, output: path.join(temp, "screenshots") };
}

afterEach(() => {
  for (const temp of temps.splice(0)) rmSync(temp, { recursive: true, force: true });
});

describe("parseCaptureShards", () => {
  it("accepts a complete set or a consecutive selected prefix", () => {
    expect(parseCaptureShards("[1,2,3,4,5,6,7,8]")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseCaptureShards("[1,2,3]")).toEqual([1, 2, 3]);
    for (const invalid of [
      "",
      "not-json",
      "[]",
      "[2]",
      "[1,3]",
      "[1,1]",
      "[1.5]",
      "[1,2,3,4,5,6,7,8,9]",
    ]) {
      expect(() => parseCaptureShards(invalid)).toThrow();
    }
  });

  it("requires all eight shards only for all-capture mode", () => {
    expect(validateCaptureSelection("all", "[1,2,3,4,5,6,7,8]")).toHaveLength(8);
    expect(validateCaptureSelection("affected", "[1,2,3]")).toEqual([1, 2, 3]);
    expect(validateCaptureSelection("light", "[1]")).toEqual([1]);
    expect(() => validateCaptureSelection("all", "[1]")).toThrow(/every shard/);
    expect(() => validateCaptureSelection("unknown", "[1]")).toThrow(/capture mode/);
  });
});

describe("sanitizeVisualArtifacts", () => {
  it("decodes and re-encodes fixed-name PNGs from each expected shard", async () => {
    const { root, output } = fixture();
    const withTrailingData = Buffer.concat([PNG, Buffer.from("untrusted trailing bytes")]);
    writeFileSync(path.join(root, "shard-1", "schedule-light-vw-390.png"), withTrailingData);
    writeFileSync(path.join(root, "shard-2", "today-dark-vw-640.png"), PNG);

    await expect(
      sanitizeVisualArtifacts({ root, output, shards: ALL_SHARDS }),
    ).resolves.toMatchObject({
      count: 2,
    });
    const canonical = readFileSync(path.join(output, "schedule-light-vw-390.png"));
    expect(canonical).not.toEqual(withTrailingData);
    expect(canonical.includes(Buffer.from("untrusted trailing bytes"))).toBe(false);
    await expect(sharp(canonical).metadata()).resolves.toMatchObject({
      format: "png",
      width: 2,
      height: 2,
    });
  });

  it("rejects malformed PNG data, nested paths, symlinks, duplicate names, and non-PNG bytes", async () => {
    const nested = fixture();
    mkdirSync(path.join(nested.root, "shard-1", "nested"));
    await expect(sanitizeVisualArtifacts({ ...nested, shards: ALL_SHARDS })).rejects.toThrow(
      /non-file/,
    );

    const linked = fixture();
    const outside = path.join(linked.temp, "outside.png");
    writeFileSync(outside, PNG);
    symlinkSync(outside, path.join(linked.root, "shard-1", "linked.png"));
    await expect(sanitizeVisualArtifacts({ ...linked, shards: ALL_SHARDS })).rejects.toThrow(
      /non-file/,
    );

    const malformed = fixture();
    writeFileSync(
      path.join(malformed.root, "shard-1", "not-a-png.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]),
    );
    await expect(sanitizeVisualArtifacts({ ...malformed, shards: ALL_SHARDS })).rejects.toThrow(
      /PNG/u,
    );
    await expect(
      reencodePng(Buffer.concat([PNG.subarray(0, 8), Buffer.from([0, 0, 0])])),
    ).rejects.toThrow(/malformed PNG/u);

    const notPng = fixture();
    writeFileSync(path.join(notPng.root, "shard-1", "plain.png"), "not png data");
    await expect(sanitizeVisualArtifacts({ ...notPng, shards: ALL_SHARDS })).rejects.toThrow(
      /size|PNG/u,
    );

    const duplicate = fixture();
    writeFileSync(path.join(duplicate.root, "shard-1", "shared.png"), PNG);
    writeFileSync(path.join(duplicate.root, "shard-2", "shared.png"), PNG);
    await expect(sanitizeVisualArtifacts({ ...duplicate, shards: ALL_SHARDS })).rejects.toThrow(
      /duplicate/,
    );
  });
});

describe("verifyCompleteScreenshotInventory", () => {
  it("rejects a sparse artifact set against the trusted baseline manifest", () => {
    const { root } = fixture();
    const actualDir = path.join(root, "actual");
    const expectedDir = path.join(root, "expected");
    mkdirSync(actualDir);
    mkdirSync(expectedDir);
    writeFileSync(path.join(actualDir, "kept.png"), PNG);
    writeFileSync(path.join(expectedDir, "kept.png"), PNG);
    writeFileSync(path.join(expectedDir, "omitted.png"), PNG);

    expect(() =>
      verifyCompleteScreenshotInventory({ actualDir, expectedDir, requireExpected: true }),
    ).toThrow(/1 of 2 baseline screenshots are missing/u);
  });

  it("requires an established baseline inventory for pull request publishing", () => {
    const { root } = fixture();
    const actualDir = path.join(root, "actual");
    const expectedDir = path.join(root, "expected");
    mkdirSync(actualDir);
    mkdirSync(expectedDir);
    writeFileSync(path.join(actualDir, "new.png"), PNG);

    expect(() =>
      verifyCompleteScreenshotInventory({ actualDir, expectedDir, requireExpected: true }),
    ).toThrow(/no trusted baseline/u);
    expect(verifyCompleteScreenshotInventory({ actualDir, expectedDir })).toEqual({
      actualCount: 1,
      expectedCount: 0,
    });
  });

  it("allows an empty trusted baseline only for an explicit fresh start", () => {
    const { root } = fixture();
    const actualDir = path.join(root, "actual");
    const expectedDir = path.join(root, "expected");
    mkdirSync(actualDir);
    mkdirSync(expectedDir);
    writeFileSync(path.join(actualDir, "new.png"), PNG);

    expect(
      verifyCompleteScreenshotInventory({
        actualDir,
        expectedDir,
        requireExpected: true,
        allowEmptyExpected: true,
        captureMode: "all",
      }),
    ).toEqual({ actualCount: 1, expectedCount: 0 });
  });

  it("refuses a selective capture as the first trusted baseline", () => {
    const { root } = fixture();
    const actualDir = path.join(root, "actual");
    const expectedDir = path.join(root, "expected");
    mkdirSync(actualDir);
    mkdirSync(expectedDir);
    writeFileSync(path.join(actualDir, "new.png"), PNG);

    expect(() =>
      verifyCompleteScreenshotInventory({
        actualDir,
        expectedDir,
        requireExpected: true,
        allowEmptyExpected: true,
        captureMode: "light",
      }),
    ).toThrow(/fresh baseline requires a complete all-mode capture/u);
  });
});
