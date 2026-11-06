import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  hashScreenshots,
  planBaselineReuse,
  readPlan,
  restoreUnchanged,
  setAsideUnchanged,
  withPassedItems,
  writePlan,
} from "./visual-baseline-plan.mjs";
import { verifyCompleteScreenshotInventory } from "./visual-publish-artifacts.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");
const temps = [];
afterEach(() => {
  for (const temp of temps.splice(0)) rmSync(temp, { recursive: true, force: true });
});

function workspace() {
  const root = mkdtempSync(path.join(os.tmpdir(), "diveday-baseline-plan-"));
  temps.push(root);
  const dirs = {
    root,
    actualDir: path.join(root, "e2e", "screenshots"),
    workingDir: path.join(root, ".reg"),
    stashDir: path.join(root, ".reg-unchanged"),
    expectedDir: path.join(root, ".reg", "expected"),
  };
  for (const dir of [dirs.actualDir, dirs.expectedDir]) mkdirSync(dir, { recursive: true });
  return dirs;
}

describe("planBaselineReuse", () => {
  const report = {
    actualItems: ["same.png", "moved.png", "unhashed.png", "gone.png", "skipped.png"],
    actualBlobs: { "same.png": sha("same"), "moved.png": sha("old"), "gone.png": sha("gone") },
  };
  const actualHashes = {
    "same.png": sha("same"),
    "moved.png": sha("new"),
    "unhashed.png": sha("anything"),
    "added.png": sha("added"),
  };

  it("keeps a byte-identical capture out of the fetch and fetches the rest a full run needs", () => {
    expect(planBaselineReuse({ report, actualHashes, selective: false })).toMatchObject({
      unchanged: ["same.png"],
      filled: [],
      // moved, the capture with no recorded hash, and the two main stopped capturing
      fetch: ["gone.png", "moved.png", "skipped.png", "unhashed.png"],
    });
  });

  it("treats a surface a selective run skipped as unchanged without fetching it", () => {
    expect(planBaselineReuse({ report, actualHashes, selective: true })).toMatchObject({
      unchanged: ["same.png"],
      filled: ["gone.png", "skipped.png"],
      fetch: ["moved.png", "unhashed.png"],
    });
  });

  it("gives no plan for a report without usable hashes", () => {
    for (const actualBlobs of [undefined, {}, [], { "same.png": "../etc/passwd" }]) {
      expect(
        planBaselineReuse({ report: { ...report, actualBlobs }, actualHashes, selective: false }),
      ).toBeNull();
    }
  });

  it("never lets an unsafe name into the plan", () => {
    const plan = planBaselineReuse({
      report: { actualItems: ["../up.png", "ok.png"], actualBlobs: { "ok.png": sha("ok") } },
      actualHashes: { "ok.png": sha("ok") },
      selective: false,
    });
    expect(plan.unchanged).toEqual(["ok.png"]);
    expect(plan.fetch).toEqual([]);
  });
});

describe("a plan is bound to its baseline", () => {
  const key = "a".repeat(40);
  const version = "b".repeat(64);
  const report = {
    actualItems: ["same.png"],
    actualBlobs: { "same.png": sha("same") },
  };
  const draw = () =>
    planBaselineReuse({
      report,
      actualHashes: { "same.png": sha("same") },
      selective: false,
      key,
      version,
    });

  it("records the baseline it was drawn from", () => {
    expect(draw()).toMatchObject({ baselineKey: key, baselineVersion: version });
  });

  it("is refused for another key or version, and for none", () => {
    const { root } = workspace();
    const file = path.join(root, "plan.json");
    writePlan(draw(), file);
    expect(readPlan(file, { key, version })).toMatchObject({ unchanged: ["same.png"] });
    expect(() => readPlan(file, { key: "c".repeat(40), version })).toThrow(/different baseline/u);
    expect(() => readPlan(file, { key, version: "d".repeat(64) })).toThrow(/different baseline/u);
    expect(() => readPlan(file)).toThrow(/different baseline/u);
  });
});

describe("readPlan", () => {
  it("returns null without a plan and refuses a malformed one", () => {
    const { root } = workspace();
    const file = path.join(root, "plan.json");
    expect(readPlan(file)).toBeNull();
    writeFileSync(
      file,
      JSON.stringify({ version: 1, unchanged: ["../x.png"], filled: [], fetch: [] }),
    );
    expect(() => readPlan(file)).toThrow(/unexpected shape/u);
    writeFileSync(file, "not json");
    expect(() => readPlan(file)).toThrow(/not valid JSON/u);
  });
});

describe("setting unchanged captures aside around the compare", () => {
  it("returns them to the capture directory and the published copy, listed as passed", () => {
    const { actualDir, workingDir, stashDir } = workspace();
    mkdirSync(path.join(workingDir, "actual"), { recursive: true });
    writeFileSync(path.join(actualDir, "same.png"), "same");
    writeFileSync(path.join(actualDir, "moved.png"), "new");
    writeFileSync(path.join(workingDir, "actual", "moved.png"), "new");
    writeFileSync(
      path.join(workingDir, "out.json"),
      JSON.stringify({
        failedItems: ["moved.png"],
        newItems: [],
        deletedItems: [],
        passedItems: [],
        expectedItems: ["moved.png"],
        actualItems: ["moved.png"],
      }),
    );
    const plan = {
      version: 1,
      unchanged: ["same.png"],
      filled: ["skipped.png"],
      fetch: ["moved.png"],
    };

    setAsideUnchanged({ plan, actualDir, stashDir });
    expect(readdirSync(actualDir)).toEqual(["moved.png"]);

    restoreUnchanged({ plan, actualDir, workingDir, stashDir });
    expect(readdirSync(actualDir).sort()).toEqual(["moved.png", "same.png"]);
    expect(readFileSync(path.join(workingDir, "actual", "same.png"), "utf8")).toBe("same");
    expect(existsSync(stashDir)).toBe(false);
    expect(JSON.parse(readFileSync(path.join(workingDir, "out.json"), "utf8"))).toEqual({
      failedItems: ["moved.png"],
      newItems: [],
      deletedItems: [],
      passedItems: ["same.png", "skipped.png"],
      expectedItems: ["moved.png", "same.png", "skipped.png"],
      actualItems: ["moved.png", "same.png", "skipped.png"],
    });
  });

  it("adds a name once however often it is added", () => {
    const report = { passedItems: ["a.png"], expectedItems: ["a.png"], actualItems: ["a.png"] };
    expect(withPassedItems(report, ["a.png", "b.png"]).passedItems).toEqual(["a.png", "b.png"]);
  });
});

describe("the inventory check with a plan", () => {
  it("counts the images left out of the expected directory as baseline surfaces", () => {
    const { actualDir, expectedDir } = workspace();
    for (const name of ["same.png", "moved.png"]) writeFileSync(path.join(actualDir, name), "x");
    writeFileSync(path.join(expectedDir, "moved.png"), "x");
    const plan = {
      version: 1,
      unchanged: ["same.png"],
      filled: ["skipped.png"],
      fetch: ["moved.png"],
    };

    expect(
      verifyCompleteScreenshotInventory({
        actualDir,
        expectedDir,
        requireExpected: true,
        captureMode: "affected",
        plan,
      }),
    ).toMatchObject({ actualCount: 3, expectedCount: 3 });
  });

  it("still refuses a captured surface the baseline lost, plan or not", () => {
    const { actualDir, expectedDir } = workspace();
    writeFileSync(path.join(actualDir, "same.png"), "x");
    writeFileSync(path.join(expectedDir, "lost.png"), "x");
    expect(() =>
      verifyCompleteScreenshotInventory({
        actualDir,
        expectedDir,
        requireExpected: true,
        captureMode: "affected",
        plan: { version: 1, unchanged: ["same.png"], filled: [], fetch: ["lost.png"] },
      }),
    ).toThrow(/visual capture is incomplete/u);
  });
});

describe("hashScreenshots", () => {
  it("hashes PNGs and ignores everything else", () => {
    const { actualDir } = workspace();
    writeFileSync(path.join(actualDir, "a.png"), "a");
    writeFileSync(path.join(actualDir, "notes.txt"), "n");
    expect(hashScreenshots(actualDir)).toEqual({ "a.png": sha("a") });
    expect(hashScreenshots(path.join(actualDir, "missing"))).toEqual({});
  });
});
