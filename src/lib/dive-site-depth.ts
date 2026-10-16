import { type DepthUnit, depthInUnit } from "./depth-units";

/**
 * A dive site's depth as the shop reads it: the shallow end and the deepest
 * point in the shop's unit, rounded to whole units like every other depth on a
 * briefing. Both are stored in metres (`dive_sites.depth_min_meters` and
 * `max_depth_meters`), so a briefing prints one unit and follows a shop that
 * flips its setting.
 *
 * Null when the shop recorded no deepest point: a shallow end alone is not a
 * range. `min` is null when there is no shallow end, or when it rounds to the
 * same figure as the deepest point, so a caller prints one number or a range.
 * Framework-free and word-free: the unit's words come from the bundle.
 */
export type SiteDepthInUnit = { min: number | null; max: number };

export function siteDepthInUnit(
  depth: { depthMinMeters?: number | null; maxDepthMeters?: number | null },
  unit: DepthUnit,
): SiteDepthInUnit | null {
  const { depthMinMeters, maxDepthMeters } = depth;
  if (maxDepthMeters == null) return null;
  const max = depthInUnit(maxDepthMeters, unit);
  const min = depthMinMeters == null ? null : depthInUnit(depthMinMeters, unit);
  return { min: min !== null && min < max ? min : null, max };
}
