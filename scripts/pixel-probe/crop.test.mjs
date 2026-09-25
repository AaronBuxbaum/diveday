import { describe, expect, it } from "vitest";
import { cropRegion, cropScale, MAX_EDGE, MAX_PIXELS, renderCrop } from "./crop.mjs";

/**
 * The crop rules are the difference between a flag someone can judge and one
 * they wave through: small boxes blown up so each CSS pixel is a block, and
 * nothing bigger than the size an image is shown at without being scaled down
 * again (1,568px on the long edge, 1.15 megapixels).
 */

describe("crop scale", () => {
  it("triples a small box, doubles a medium one, and leaves a big one 1:1", () => {
    expect(cropScale(120, 60)).toBe(3);
    expect(cropScale(300, 90)).toBe(2);
    expect(cropScale(900, 200)).toBe(1);
  });

  it("steps down rather than exceed the size limits", () => {
    // 400×400 at ×2 is 640,000 pixels — allowed; a 160-wide, 400-tall box at
    // ×3 would be 1,200px tall and 576,000 pixels — also allowed at ×2 only
    // because the long edge rule picks ×2 first.
    expect(cropScale(160, 400)).toBe(2);
    for (const [w, h] of [
      [150, 150],
      [390, 390],
      [1000, 1000],
    ]) {
      const scale = cropScale(w, h);
      expect(w * scale).toBeLessThanOrEqual(MAX_EDGE);
      if (scale > 1) expect(w * h * scale * scale).toBeLessThanOrEqual(MAX_PIXELS);
    }
  });
});

describe("crop region", () => {
  it("adds the margin and clamps to the image", () => {
    expect(cropRegion([4, 4, 20, 20], 100, 100)).toEqual({ x: 0, y: 0, w: 40, h: 40 });
    expect(cropRegion([80, 80, 20, 20], 100, 100)).toEqual({ x: 64, y: 64, w: 36, h: 36 });
  });

  it("cuts a region too big to show down to the limits", () => {
    const region = cropRegion([0, 0, 1280, 5000], 1280, 6000);
    expect(region.w).toBeLessThanOrEqual(MAX_EDGE);
    expect(region.w * region.h).toBeLessThanOrEqual(MAX_PIXELS);
  });

  it("returns nothing for a box entirely off the image", () => {
    expect(cropRegion([500, 500, 10, 10], 100, 100)).toBeNull();
  });
});

describe("rendering", () => {
  it("scales nearest-neighbour and draws a guide on the box's edge", () => {
    const width = 4;
    const height = 4;
    const data = Buffer.alloc(width * height * 4, 255);
    const image = renderCrop({ data, width, height }, { x: 0, y: 0, w: 4, h: 4 }, [
      { box: [1, 1, 2, 2], color: "magenta" },
    ]);
    expect(image.width).toBe(12);
    expect(image.height).toBe(12);
    const at = (x, y) => Array.from(image.data.subarray((y * 12 + x) * 4, (y * 12 + x) * 4 + 3));
    // The guide's top-left corner lands on the first scaled pixel of (1,1).
    expect(at(3, 3)).not.toEqual([255, 255, 255]);
    // Well inside the box stays the source colour.
    expect(at(5, 5)).toEqual([255, 255, 255]);
  });
});
