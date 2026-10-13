import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { fillFromExpected, selectionNote } from "./visual-fill.mjs";

function tree(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "visual-fill-"));
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), body);
  }
  return root;
}

describe("finishing a narrowed capture", () => {
  it("copies only what was not captured, so a fresh capture is never overwritten", () => {
    const expectedDir = tree({
      "today-light.png": "old",
      "gear/register-dark.png": "old",
      "x.json": "{}",
    });
    const actualDir = tree({ "today-light.png": "new" });
    expect(fillFromExpected({ expectedDir, actualDir })).toEqual({ captured: 1, copied: 1 });
    expect(readFileSync(path.join(actualDir, "today-light.png"), "utf8")).toBe("new");
    expect(readFileSync(path.join(actualDir, "gear/register-dark.png"), "utf8")).toBe("old");
  });

  it("copies nothing when there is no baseline to copy from", () => {
    const actualDir = tree({ "today-light.png": "new" });
    expect(fillFromExpected({ expectedDir: path.join(actualDir, "missing"), actualDir })).toEqual({
      captured: 1,
      copied: 0,
    });
  });

  it("says how much was captured and where the rest came from", () => {
    expect(selectionNote({ captured: 40, copied: 1118 })).toMatch(
      /captured 40 surface\(s\).*other 1118 are the baseline's own images/,
    );
  });
});
