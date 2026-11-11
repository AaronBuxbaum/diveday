import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { prepareNearestBaseline } from "./visual-prepare-baseline.mjs";

/**
 * **The compare runs against the nearest complete main baseline** (issue #3968, Aaron
 * 2026-11-06: do not block on a baseline; use the closest one available). A resolved snapshot
 * whose report or an image is missing from the bucket hands over to the nearest main-owned
 * snapshot before it, never to one a pull request published, and never waits or fails the run.
 */
const BUCKET = "diveday-vrt";
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);
const VERSION_A = "1".repeat(64);
const VERSION_B = "2".repeat(64);
const VERSION_C = "3".repeat(64);
let PNG;
let HASH;
const temps = [];

beforeAll(async () => {
  PNG = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 9, g: 90, b: 140, alpha: 1 } },
  })
    .png()
    .toBuffer();
  HASH = createHash("sha256").update(PNG).digest("hex");
});

afterEach(() => {
  for (const temp of temps.splice(0)) rmSync(temp, { recursive: true, force: true });
});

function outputDir() {
  const root = mkdtempSync(path.join(os.tmpdir(), "diveday-visual-nearest-"));
  temps.push(root);
  return path.join(root, "expected");
}

function report(version, blobs) {
  const root = `snapshots/${version}/`;
  return {
    actualDir: `${root}actual`,
    expectedDir: `${root}expected`,
    diffDir: `${root}diff`,
    actualItems: Object.keys(blobs),
    actualBlobs: blobs,
  };
}

/**
 * A fake public bucket. `snapshots` maps a commit to its marker (`version`, `owner`) and report;
 * a blob exists only when listed in `blobs`.
 */
function bucket({ snapshots, blobs }) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const key = decodeURIComponent(new URL(String(url)).pathname.slice(1));
    requests.push(`${init.method ?? "GET"} ${key}`);
    const commit = key.split("/")[0];
    const snapshot = snapshots[commit];
    if (key.endsWith("/out.json") && snapshot) {
      const headers = { "x-amz-meta-diveday-snapshot-version": snapshot.version };
      if (snapshot.owner === "pr") headers["x-amz-meta-diveday-pr-number"] = "4000";
      if (init.method === "HEAD") return new Response(null, { status: 200, headers });
      if (snapshot.reportMissing) return new Response(null, { status: 403 });
      return new Response(JSON.stringify(snapshot.report), {
        status: 200,
        headers: { ...headers, "content-type": "application/json" },
      });
    }
    const blob = key.match(/^blobs\/([0-9a-f]{64})\.png$/u)?.[1];
    if (blob && blobs.has(blob)) {
      return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    }
    return new Response(null, { status: 403 });
  };
  return { fetchImpl, requests };
}

/** First-parent history A <- B <- C <- D, newest first from the key. */
function git(args) {
  const [command, ref] = args;
  if (command !== "rev-parse" && command !== "rev-list") throw new Error(`unexpected ${args}`);
  const parents = { [A]: B, [B]: C, [C]: D };
  if (command === "rev-parse") {
    const parent = parents[ref.replace(/\^$/u, "")];
    if (!parent) throw new Error("no parent");
    return parent;
  }
  const start = args.at(-1).replace(/\^$/u, "");
  const walk = [];
  for (let sha = parents[start]; sha; sha = parents[sha]) walk.push(sha);
  return walk.join("\n");
}

describe("prepareNearestBaseline (#3968)", () => {
  it("starts a rejected PR's fallback at its main fork outside the feature first-parent chain", async () => {
    const { fetchImpl, requests } = bucket({
      snapshots: {
        [A]: {
          version: VERSION_A,
          owner: "pr",
          report: { ...report(VERSION_A, { "x.png": HASH }), partialActual: true },
        },
        [C]: { version: VERSION_C, owner: "main", report: report(VERSION_C, { "x.png": HASH }) },
      },
      blobs: new Set([HASH]),
    });
    const calls = [];
    const longStackGit = (args) => {
      calls.push(args);
      if (args[0] === "merge-base" && args[1] === A && args[2] === "origin/trunk") return C;
      if (args[0] === "rev-parse" && args[1] === `${A}^`) return B;
      if (args[0] === "rev-list") {
        return Array.from({ length: 40 }, (_, i) => (i + 1).toString(16).padStart(40, "0")).join(
          "\n",
        );
      }
      throw new Error(`unexpected ${args}`);
    };
    const result = await prepareNearestBaseline({
      git: longStackGit,
      defaultBranch: "trunk",
      bucket: BUCKET,
      key: A,
      version: VERSION_A,
      outputDir: outputDir(),
      fetchImpl,
    });
    expect(result).toMatchObject({ key: C, version: VERSION_C, count: 1, passedOver: [A] });
    expect(calls).toEqual([["merge-base", A, "origin/trunk"]]);
    expect(requests).not.toContain(`HEAD ${B}/out.json`);
  });

  it("passes over a report-only PR snapshot instead of treating its 76 uploads as the whole baseline", async () => {
    const baseline = Array.from({ length: 1740 }, (_, i) => `surface-${i}.png`);
    const changed = baseline.slice(0, 70);
    const added = Array.from({ length: 6 }, (_, i) => `new-${i}.png`);
    const partial = {
      ...report(VERSION_A, {}),
      actualItems: [...changed, ...added],
      expectedItems: baseline,
      passedItems: baseline.slice(70),
      failedItems: changed,
      newItems: added,
      partialActual: true,
    };
    const fake = bucket({
      snapshots: {
        [A]: { version: VERSION_A, owner: "pr", report: partial },
        [C]: {
          version: VERSION_C,
          owner: "main",
          report: report(VERSION_C, Object.fromEntries(baseline.map((name) => [name, HASH]))),
        },
      },
      blobs: new Set([HASH]),
    });
    const partialImagePrefix = `${A}/snapshots/${VERSION_A}/actual/`;
    const fetchedPartialImages = [];
    const fetchImpl = async (url, init) => {
      const key = new URL(String(url)).pathname.slice(1);
      if (key.startsWith(partialImagePrefix)) {
        fetchedPartialImages.push(key);
        return new Response(PNG, { status: 200 });
      }
      return fake.fetchImpl(url, init);
    };
    const result = await prepareNearestBaseline({
      git,
      bucket: BUCKET,
      key: A,
      version: VERSION_A,
      outputDir: outputDir(),
      fetchImpl,
    });
    expect(result).toMatchObject({ key: C, version: VERSION_C, count: 1740, passedOver: [A] });
    expect(fetchedPartialImages).toEqual([]);
  });

  it("compares against the resolved baseline when it is whole, and passes nothing over", async () => {
    const { fetchImpl } = bucket({
      snapshots: {
        [A]: { version: VERSION_A, owner: "main", report: report(VERSION_A, { "x.png": HASH }) },
      },
      blobs: new Set([HASH]),
    });
    const result = await prepareNearestBaseline({
      git,
      bucket: BUCKET,
      key: A,
      version: VERSION_A,
      outputDir: outputDir(),
      fetchImpl,
    });
    expect(result).toMatchObject({ key: A, version: VERSION_A, count: 1, passedOver: [] });
  });

  it("hands a snapshot missing an image over to the nearest main-owned one before it", async () => {
    const missingBlob = "f".repeat(64);
    const { fetchImpl } = bucket({
      snapshots: {
        [A]: {
          version: VERSION_A,
          owner: "main",
          report: report(VERSION_A, { "x.png": missingBlob }),
        },
        // A pull request's marker is never a baseline, however near.
        [B]: { version: VERSION_B, owner: "pr", report: report(VERSION_B, { "x.png": HASH }) },
        [C]: { version: VERSION_C, owner: "main", report: report(VERSION_C, { "x.png": HASH }) },
      },
      blobs: new Set([HASH]),
    });
    const dir = outputDir();
    const result = await prepareNearestBaseline({
      git: (args) => (args[0] === "merge-base" ? args[1] : git(args)),
      bucket: BUCKET,
      key: A,
      version: VERSION_A,
      outputDir: dir,
      fetchImpl,
    });
    expect(result).toMatchObject({ key: C, version: VERSION_C, count: 1, passedOver: [A] });
    expect(readdirSync(dir)).toEqual(["x.png"]);
  });

  it("hands a snapshot whose report is gone over too", async () => {
    const { fetchImpl } = bucket({
      snapshots: {
        [A]: { version: VERSION_A, owner: "main", reportMissing: true },
        [B]: { version: VERSION_B, owner: "main", report: report(VERSION_B, { "x.png": HASH }) },
      },
      blobs: new Set([HASH]),
    });
    const result = await prepareNearestBaseline({
      git,
      bucket: BUCKET,
      key: A,
      version: VERSION_A,
      outputDir: outputDir(),
      fetchImpl,
    });
    expect(result).toMatchObject({ key: B, version: VERSION_B, passedOver: [A] });
  });

  it("ends with no baseline, never a throw or a wait, when nothing complete is within reach", async () => {
    const missingBlob = "e".repeat(64);
    const { fetchImpl, requests } = bucket({
      snapshots: {
        [A]: {
          version: VERSION_A,
          owner: "main",
          report: report(VERSION_A, { "x.png": missingBlob }),
        },
        [B]: {
          version: VERSION_B,
          owner: "main",
          report: report(VERSION_B, { "x.png": missingBlob }),
        },
      },
      blobs: new Set(),
    });
    const result = await prepareNearestBaseline({
      git,
      bucket: BUCKET,
      key: A,
      version: VERSION_A,
      outputDir: outputDir(),
      fetchImpl,
    });
    expect(result).toMatchObject({ key: "", version: "", count: 0, passedOver: [A, B] });
    // Bounded: two reports, two blobs and the HEAD walk, and nothing after.
    expect(requests.length).toBeLessThan(20);
  });

  it("still fails on an image that disagrees with its hash: a wrong baseline is not a missing one", async () => {
    const wrongHash = "9".repeat(64);
    const { fetchImpl } = bucket({
      snapshots: {
        [A]: {
          version: VERSION_A,
          owner: "main",
          report: report(VERSION_A, { "x.png": wrongHash }),
        },
      },
      blobs: new Set([wrongHash]),
    });
    await expect(
      prepareNearestBaseline({
        git,
        bucket: BUCKET,
        key: A,
        version: VERSION_A,
        outputDir: outputDir(),
        fetchImpl,
      }),
    ).rejects.toThrow(/content hash/u);
  });
});
