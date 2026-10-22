import { describe, expect, it } from "vitest";
import { labelRectangle, placeMapLabel, rectanglesOverlap } from "./map-label-placement";

const viewport = { x: 390, y: 440 };
const size = { x: 44, y: 44 };

describe("map label placement", () => {
  it.each([
    {
      preferred: { x: 25, y: 48 },
      obstacles: [
        { left: 10, right: 54, top: 10, bottom: 98 },
        { left: 0, right: 58, top: 100, bottom: 158 },
        { left: 60, right: 118, top: 32, bottom: 90 },
      ],
    },
    {
      preferred: { x: 368, y: 418 },
      obstacles: [
        { left: 250, right: 390, top: 410, bottom: 440 },
        { left: 324, right: 382, top: 340, bottom: 398 },
        { left: 260, right: 318, top: 330, bottom: 388 },
      ],
    },
  ])(
    "checks final clearance against every control and cluster near viewport edges: $preferred",
    ({ preferred, obstacles }) => {
      const position = placeMapLabel(preferred, size, viewport, obstacles);
      const rectangle = labelRectangle(position, size);
      expect(rectangle.left).toBeGreaterThanOrEqual(4);
      expect(rectangle.top).toBeGreaterThanOrEqual(4);
      expect(rectangle.right).toBeLessThanOrEqual(viewport.x - 4);
      expect(rectangle.bottom).toBeLessThanOrEqual(viewport.y - 4);
      for (const obstacle of obstacles) expect(rectanglesOverlap(rectangle, obstacle)).toBe(false);
      // Reopening a tooltip or updating its measurements must not move a settled badge.
      expect(placeMapLabel(preferred, size, viewport, obstacles)).toEqual(position);
    },
  );

  it("leaves a clear geographic preference in place", () => {
    const preferred = { x: 180, y: 200 };
    expect(
      placeMapLabel(preferred, size, viewport, [{ left: 10, right: 54, top: 10, bottom: 98 }]),
    ).toEqual(preferred);
  });
});
