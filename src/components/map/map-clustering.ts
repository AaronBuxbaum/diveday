export type ProjectedMapPoint<T extends { id: string }> = {
  pin: T;
  x: number;
  y: number;
};

/** A cluster is roughly one marker wide on screen, regardless of map zoom. */
export const MAP_CLUSTER_GRID_SIZE = 56;

/**
 * Group projected points by screen cells. This runs in O(n) and returns only
 * clusters, so overlapping pins do not create a large DOM marker layer.
 * Keeping the selected pin alone lets its popup remain directly addressable.
 */
export function clusterMapPoints<T extends { id: string }>(
  points: readonly ProjectedMapPoint<T>[],
  selectedPinId?: string | null,
  cellSize = MAP_CLUSTER_GRID_SIZE,
): T[][] {
  const cells = new Map<string, T[]>();

  for (const point of points) {
    const key =
      point.pin.id === selectedPinId
        ? `selected:${point.pin.id}`
        : `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
    const group = cells.get(key);
    if (group) group.push(point.pin);
    else cells.set(key, [point.pin]);
  }

  return [...cells.values()];
}
