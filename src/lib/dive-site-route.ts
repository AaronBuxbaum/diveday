/**
 * The line a shop draws over its dive site.
 *
 * Every briefing that shows a satellite frame wants the same thing on top of
 * it: *this is where we swim*. Until now exactly three sites had one, because
 * the three paths were hand-authored SVG in a lookup table keyed by site name
 * — so a shop's own site could never have a route, and DiveDay's three could
 * never be edited. This module is the shape that replaced that table: a list
 * of waypoints a staffer clicked, stored on the site row, turned back into a
 * curve here.
 *
 * **Why percentages and not coordinates.** A waypoint is a percentage of the
 * satellite frame (0–100, origin top-left), because that is the space the
 * drawing happens in: the overlay is an SVG with `viewBox="0 0 100 100"` sitting
 * exactly on top of the embed. Latitude/longitude would be the more universal
 * unit and the wrong one — turning it back into a screen position needs the
 * projection, the centre and the zoom of a third-party iframe we cannot query.
 *
 * The cost of that choice is the rule the editor enforces: the frame is fixed
 * by the site's `forecastLatitude`/`forecastLongitude` and `routeZoom`, and the
 * map cannot be panned while drawing. A route drawn over a view the briefing
 * cannot reproduce is a line over the wrong water — worse than no line, on a
 * surface whose whole job is telling a diver where they are going.
 *
 * Codes and geometry only, no sentences (AGENTS.md).
 */

/** One waypoint, as a percentage of the satellite frame. */
export type RoutePoint = { x: number; y: number };

/**
 * The most waypoints a route may carry.
 *
 * A dozen is already more than a briefing can read at a glance, and the cap is
 * what keeps a stuck finger — or a crafted POST — from storing a thousand-point
 * blob on a row every trip page loads.
 */
export const MAX_ROUTE_POINTS = 12;

/** Below this a "route" is a dot, not a path; the briefing draws nothing. */
export const MIN_ROUTE_POINTS = 2;

/** Zoom levels the editor offers, and the only ones a stored route may use. */
export const MIN_ROUTE_ZOOM = 12;
export const MAX_ROUTE_ZOOM = 19;
export const DEFAULT_ROUTE_ZOOM = 16;

/** Rounded to this many decimals — sub-pixel precision no one can click. */
const COORDINATE_DECIMALS = 2;

function clampCoordinate(value: number): number {
  const bounded = Math.min(100, Math.max(0, value));
  const factor = 10 ** COORDINATE_DECIMALS;
  return Math.round(bounded * factor) / factor;
}

/**
 * Waypoints from anywhere untrusted — a form post, a stored row written by an
 * older build, an import — reduced to the shape the renderer can assume.
 *
 * Never throws and never partially trusts: anything that is not a finite pair
 * of numbers is dropped, coordinates are clamped into the frame, and the list
 * is cut to {@link MAX_ROUTE_POINTS}. A caller gets a drawable route or an
 * empty one, and an empty one is a first-class answer (most sites have no
 * route).
 */
export function parseRoutePoints(raw: unknown): RoutePoint[] {
  const list = typeof raw === "string" ? safeJson(raw) : raw;
  if (!Array.isArray(list)) return [];
  const points: RoutePoint[] = [];
  for (const entry of list) {
    if (points.length >= MAX_ROUTE_POINTS) break;
    if (typeof entry !== "object" || entry === null) continue;
    const { x, y } = entry as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({ x: clampCoordinate(x), y: clampCoordinate(y) });
  }
  return points;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** A stored or submitted zoom, clamped to what the editor can actually draw at. */
export function parseRouteZoom(raw: unknown): number {
  const value = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_ROUTE_ZOOM;
  return Math.min(MAX_ROUTE_ZOOM, Math.max(MIN_ROUTE_ZOOM, Math.round(value)));
}

/** Whether these waypoints amount to a route worth drawing. */
export function hasRoute(points: readonly RoutePoint[]): boolean {
  return points.length >= MIN_ROUTE_POINTS;
}

/**
 * The waypoints as one SVG `d`, smoothed.
 *
 * Catmull-Rom through the clicked points, converted to the cubic Béziers SVG
 * speaks. Straight segments would be honest too, but a dive route is a swim,
 * not a survey traverse, and the elbows of a polyline read as a *plan with
 * corners* — which is exactly what the hand-authored paths this replaced were
 * drawn to avoid. A staffer clicking five points gets the curve they were
 * picturing rather than a zig-zag they now have to add points to soften.
 *
 * The tension (1/6) is the standard uniform Catmull-Rom conversion: the curve
 * passes through every clicked point, so nothing drifts off the reef the
 * staffer aimed at.
 *
 * Returns an empty string for anything under {@link MIN_ROUTE_POINTS} — the
 * caller draws no `<path>` at all rather than a zero-length one.
 */
export function routePathD(points: readonly RoutePoint[]): string {
  if (!hasRoute(points)) return "";
  const round = (value: number) => Math.round(value * 100) / 100;
  let d = `M ${round(points[0].x)} ${round(points[0].y)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    // The two points either side of this segment, with the ends duplicated so
    // the first and last segments bend the same way the interior ones do.
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const after = points[index + 2] ?? next;
    const control1 = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    };
    const control2 = {
      x: next.x - (after.x - current.x) / 6,
      y: next.y - (after.y - current.y) / 6,
    };
    d += ` C ${round(control1.x)} ${round(control1.y)}, ${round(control2.x)} ${round(control2.y)}, ${round(next.x)} ${round(next.y)}`;
  }
  return d;
}

/**
 * The map query for a site's satellite frame.
 *
 * Coordinates, not the site's name: a name is matched by the map provider
 * against whatever it can find, and "Blue Hole" centres on a different ocean
 * depending on the day. A route is percentages *of this frame*, so the frame
 * has to be the same one every time or the line lands on the wrong water.
 * Null when the site has no coordinates — the caller draws no map rather than
 * one centred on a guess.
 */
export function routeMapQuery(site: {
  forecastLatitude: number | null;
  forecastLongitude: number | null;
}): string | null {
  const { forecastLatitude: lat, forecastLongitude: lng } = site;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${lat},${lng}`;
}
