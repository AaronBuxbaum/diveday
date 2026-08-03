/**
 * Depth is stored in metres everywhere — `dive_sites.max_depth_meters`, the
 * certification ceilings in `depth-ceiling.ts`, the agency standards those came
 * from. A shop's `depth_unit` changes only how a number is *typed in and read
 * back*, never what is on disk, so switching a shop from metres to feet
 * reinterprets no existing row.
 *
 * Framework-free and word-free: this module returns numbers and unit codes, and
 * the message bundle turns them into "18 m" or "60 ft" (AGENTS.md — src/lib
 * returns codes, not sentences).
 */

/** How a shop reads depth. Mirrors the `depth_unit` pg enum. */
export type DepthUnit = "meters" | "feet";

/** The international foot, exactly. Diving tables round; the conversion doesn't. */
const FEET_PER_METER = 1 / 0.3048;

export function metersToFeet(meters: number): number {
  return meters * FEET_PER_METER;
}

export function feetToMeters(feet: number): number {
  return feet * 0.3048;
}

/**
 * A stored depth in metres, converted into the shop's unit and rounded to a
 * whole number for display. Whole units on purpose: a site's maximum depth is a
 * briefing figure, and "18.3 m" implies a precision no dive site has.
 *
 * Round-trips exactly for a shop working in feet — 60 ft stores as 18.288 m and
 * reads back as 60 — which is why the column is floating-point.
 */
export function depthInUnit(meters: number, unit: DepthUnit): number {
  return Math.round(unit === "feet" ? metersToFeet(meters) : meters);
}

/** A depth typed in the shop's unit, converted to the metres actually stored. */
export function depthToMeters(value: number, unit: DepthUnit): number {
  return unit === "feet" ? feetToMeters(value) : value;
}

/**
 * The largest depth the entry forms accept, in the shop's own unit. A typo
 * guard, not a claim about diveable depth: it sits well past the 40 m/130 ft
 * recreational limit so a technical site is still recordable, while a chart
 * sounding pasted in by mistake is not.
 */
export const MAX_ENTERED_DEPTH_METERS = 300;

export function maxEnteredDepth(unit: DepthUnit): number {
  return Math.round(depthInUnit(MAX_ENTERED_DEPTH_METERS, unit));
}

/**
 * The largest underwater visibility the conditions form accepts, in metres.
 * Separate from the depth ceiling above and much lower: 100 m is already the
 * clearest water on earth (a Bahamian blue hole on a still day), so a bigger
 * number is a typo, not a record.
 */
export const MAX_ENTERED_VISIBILITY_METERS = 100;

/**
 * The same bound in the shop's own unit. Rounded down, never to nearest — a
 * ceiling offered in feet must still convert to something the metres bound
 * accepts.
 */
export function maxEnteredVisibility(unit: DepthUnit): number {
  return unit === "feet"
    ? Math.floor(metersToFeet(MAX_ENTERED_VISIBILITY_METERS))
    : MAX_ENTERED_VISIBILITY_METERS;
}
