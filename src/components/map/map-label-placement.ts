import type { MapTargetRectangle } from "./map-clustering";

type Point = { x: number; y: number };

/** Place a label in the viewport without covering geographic targets or controls. */
export function placeMapLabel(
  preferred: Point,
  size: Point,
  viewport: Point,
  obstacles: readonly MapTargetRectangle[],
): Point {
  const halfWidth = size.x / 2;
  const halfHeight = size.y / 2;
  const clamp = (point: Point) => ({
    x: Math.max(halfWidth + 4, Math.min(viewport.x - halfWidth - 4, point.x)),
    y: Math.max(halfHeight + 4, Math.min(viewport.y - halfHeight - 4, point.y)),
  });
  const origin = clamp(preferred);
  const candidates = [origin];
  for (const obstacle of obstacles) {
    const left = obstacle.left - 4 - halfWidth;
    const right = obstacle.right + 4 + halfWidth;
    const top = obstacle.top - 4 - halfHeight;
    const bottom = obstacle.bottom + 4 + halfHeight;
    candidates.push(
      ...[left, right].flatMap((x) => [origin.y, top, bottom].map((y) => clamp({ x, y }))),
      clamp({ x: origin.x, y: top }),
      clamp({ x: origin.x, y: bottom }),
    );
  }
  candidates.sort(
    (a, b) =>
      Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y),
  );
  return (
    candidates.find(
      (point) =>
        !obstacles.some((obstacle) => rectanglesOverlap(labelRectangle(point, size), obstacle)),
    ) ?? origin
  );
}

export function labelRectangle(center: Point, size: Point): MapTargetRectangle {
  return {
    left: center.x - size.x / 2,
    right: center.x + size.x / 2,
    top: center.y - size.y / 2,
    bottom: center.y + size.y / 2,
  };
}

export function rectanglesOverlap(a: MapTargetRectangle, b: MapTargetRectangle) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
