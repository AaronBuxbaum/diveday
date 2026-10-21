export type ProjectedMapPoint<T extends { id: string }> = {
  pin: T;
  x: number;
  y: number;
};

/** Enough separation for 44px cluster buttons and their hover/focus treatment. */
export const MAP_CLUSTER_GRID_SIZE = 56;

/**
 * Group nearby points around fixed representatives, checking neighboring cells
 * as well as each point's own cell. Every unselected group's first point is its
 * display anchor; anchors remain at least one cell size apart. Averaging them
 * afterwards would undo that spacing and can overlap adjacent cluster buttons.
 * The separated anchors bound each cell's candidates, so this remains O(n).
 * Keeping the selected pin alone lets its popup remain directly addressable.
 */
export function clusterMapPoints<T extends { id: string }>(
  points: readonly ProjectedMapPoint<T>[],
  selectedPinId?: string | null,
  cellSize = MAP_CLUSTER_GRID_SIZE,
): T[][] {
  type Group = { x: number; y: number; pins: T[] };
  const cells = new Map<string, Group[]>();
  const groups: T[][] = [];

  for (const point of points) {
    if (point.pin.id === selectedPinId) {
      groups.push([point.pin]);
      continue;
    }

    const cellX = Math.floor(point.x / cellSize);
    const cellY = Math.floor(point.y / cellSize);
    let nearest: Group | undefined;
    let nearestDistance = cellSize * cellSize;
    for (let x = cellX - 1; x <= cellX + 1; x += 1) {
      for (let y = cellY - 1; y <= cellY + 1; y += 1) {
        for (const candidate of cells.get(`${x}:${y}`) ?? []) {
          const distance = (point.x - candidate.x) ** 2 + (point.y - candidate.y) ** 2;
          if (distance < nearestDistance) {
            nearest = candidate;
            nearestDistance = distance;
          }
        }
      }
    }

    if (nearest) {
      nearest.pins.push(point.pin);
      continue;
    }

    const group = { x: point.x, y: point.y, pins: [point.pin] };
    const key = `${cellX}:${cellY}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(group);
    else cells.set(key, [group]);
    groups.push(group.pins);
  }

  return groups;
}

/** Keep the contextual shop target clear without dropping or splitting a site group. */
export function separateShopAnchor<T extends { id: string }>(
  groups: T[][],
  points: readonly ProjectedMapPoint<T>[],
  shop: { x: number; y: number } | null,
  canPlace: (pin: T) => boolean,
): { groups: T[][]; showShopAnchor: boolean } {
  if (!shop) return { groups, showShopAnchor: true };
  const positions = new Map(points.map((point) => [point.pin.id, point]));
  const anchors = groups.map((group) => {
    const pin = group[0];
    return pin ? positions.get(pin.id) : undefined;
  });
  const resolved = [...groups];
  const clearOf = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - b.x) ** 2 + (a.y - b.y) ** 2 >= MAP_CLUSTER_GRID_SIZE ** 2;

  for (let index = 0; index < groups.length; index += 1) {
    const anchor = anchors[index];
    if (!anchor || clearOf(anchor, shop)) continue;
    const representative = groups[index].find((pin) => {
      const point = positions.get(pin.id);
      return (
        point &&
        clearOf(point, shop) &&
        canPlace(pin) &&
        anchors.every(
          (other, otherIndex) => otherIndex === index || !other || clearOf(point, other),
        )
      );
    });
    // Coincident or tightly packed sites may offer no clear real position.
    // Their count takes priority; the shop returns when zoom separates them.
    if (!representative) return { groups, showShopAnchor: false };
    resolved[index] = [representative, ...groups[index].filter((pin) => pin !== representative)];
    anchors[index] = positions.get(representative.id);
  }

  return { groups: resolved, showShopAnchor: true };
}

export type MapTargetRectangle = { left: number; right: number; top: number; bottom: number };

/** Do not expose a clipped button or one covered by the map's own controls. */
export function mapTargetIsVisible(
  point: { x: number; y: number },
  size: number,
  viewport: { x: number; y: number },
  controls: readonly MapTargetRectangle[],
): boolean {
  const radius = size / 2;
  const target = {
    left: point.x - radius,
    right: point.x + radius,
    top: point.y - radius,
    bottom: point.y + radius,
  };
  return (
    target.left >= 0 &&
    target.top >= 0 &&
    target.right <= viewport.x &&
    target.bottom <= viewport.y &&
    !controls.some(
      (control) =>
        target.left < control.right &&
        target.right > control.left &&
        target.top < control.bottom &&
        target.bottom > control.top,
    )
  );
}
