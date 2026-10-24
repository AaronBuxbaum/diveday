import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compareCaptureSets, listPngs, summarize } from "./compare-capture-sets.mjs";

let root;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "capture-sets-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A capture folder holding `files` (name → bytes). */
async function set(name, files) {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  for (const [file, bytes] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), bytes);
  }
  return dir;
}

describe("compareCaptureSets", () => {
  it("finds nothing when every set holds the same bytes under the same names", async () => {
    const files = { "a-light-vw-390.png": "aaa", "b-dark-vw-1280.png": "bbb" };
    const dirs = [await set("w2-a", files), await set("w2-b", files), await set("w1", files)];
    const result = await compareCaptureSets(dirs);
    expect(result.names).toEqual(["a-light-vw-390.png", "b-dark-vw-1280.png"]);
    expect(result.differing).toEqual([]);
    expect(summarize(dirs, result)).toContain("byte-identical");
  });

  it("names a capture whose bytes differ in any one set, and which set", async () => {
    const dirs = [
      await set("w2-a", { "a.png": "same", "b.png": "same" }),
      await set("w2-b", { "a.png": "same", "b.png": "same" }),
      await set("w1", { "a.png": "same", "b.png": "moved" }),
    ];
    const { differing } = await compareCaptureSets(dirs);
    expect(differing).toEqual([
      { name: "b.png", reason: `bytes differ: ${dirs[0]} vs ${dirs[2]}` },
    ]);
  });

  it("counts a capture missing from one set as a difference", async () => {
    const dirs = [
      await set("w2-a", { "a.png": "x", "only-here.png": "y" }),
      await set("w1", { "a.png": "x" }),
    ];
    const result = await compareCaptureSets(dirs);
    expect(result.differing).toEqual([
      { name: "only-here.png", reason: `missing from ${dirs[1]}` },
    ]);
    expect(summarize(dirs, result)).toContain("| `only-here.png` |");
  });

  it("leaves non-PNG files alone and reads nested folders", async () => {
    const dir = await set("w1", { "a.png": "x", "notes.txt": "t", "nested/b.png": "y" });
    expect(await listPngs(dir)).toEqual(["a.png", path.join("nested", "b.png")]);
  });

  it("refuses a single folder: there is nothing to compare it with", async () => {
    await expect(compareCaptureSets([await set("w1", { "a.png": "x" })])).rejects.toThrow(
      /at least two/,
    );
  });
});
