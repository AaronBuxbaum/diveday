import { describe, expect, it } from "vitest";

import { compareCaptures, describeDifference, pixelDifference } from "./visual-diff-layers.mjs";

const map = (entries) => new Map(Object.entries(entries));

describe("compareCaptures", () => {
  it("sorts captures by whether their bytes moved", () => {
    const result = compareCaptures(
      map({ "a.png": '"1"', "b.png": '"2"', "gone.png": '"3"' }),
      map({ "a.png": '"1"', "b.png": '"9"', "new.png": '"4"' }),
    );
    expect(result).toEqual({
      same: ["a.png"],
      differs: ["b.png"],
      onlyFrom: ["gone.png"],
      onlyTo: ["new.png"],
      unknown: [],
    });
  });

  it("never reads a failed HEAD as unchanged", () => {
    // Two nulls are equal values and mean nothing: the capture is unknown.
    const result = compareCaptures(map({ "a.png": null }), map({ "a.png": null }));
    expect(result.same).toEqual([]);
    expect(result.unknown).toEqual(["a.png"]);
    expect(compareCaptures(map({ "b.png": '"1"' }), map({ "b.png": null })).unknown).toEqual([
      "b.png",
    ]);
  });
});

describe("pixelDifference", () => {
  const size = { width: 2, height: 2 };
  const solid = (value) => new Uint8Array(16).fill(value);

  it("counts nothing for identical pixels", () => {
    expect(pixelDifference(solid(10), solid(10), size)).toEqual({
      pixels: 0,
      maxDelta: 0,
      box: null,
    });
  });

  it("counts the moved pixels, the largest channel delta and where they are", () => {
    const changed = solid(10);
    changed[3 * 4 + 1] = 34; // bottom-right pixel, green channel, +24
    expect(pixelDifference(solid(10), changed, size)).toEqual({
      pixels: 1,
      maxDelta: 24,
      box: { top: 1, left: 1, bottom: 1, right: 1 },
    });
  });

  it("declines to count across a geometry change", () => {
    expect(pixelDifference(solid(0), new Uint8Array(32), size)).toBeNull();
  });
});

describe("describeDifference", () => {
  it("names a height change before anything about pixels", () => {
    expect(
      describeDifference("x.png", {
        fromSize: { width: 390, height: 900 },
        toSize: { width: 390, height: 984 },
        diff: null,
      }),
    ).toBe("- `x.png`: geometry 390×900 → 390×984 (+84px tall)");
  });

  it("says when only the encoding moved", () => {
    expect(
      describeDifference("x.png", {
        fromSize: { width: 2, height: 2 },
        toSize: { width: 2, height: 2 },
        diff: { pixels: 0, maxDelta: 0, box: null },
      }),
    ).toContain("pixels identical");
  });

  it("locates a same-size pixel change", () => {
    expect(
      describeDifference("x.png", {
        fromSize: { width: 2, height: 2 },
        toSize: { width: 2, height: 2 },
        diff: { pixels: 463, maxDelta: 24, box: { top: 10, left: 4, bottom: 60, right: 200 } },
      }),
    ).toBe("- `x.png`: 463 pixels, max channel delta 24/255, within x 4–200, y 10–60");
  });
});
