import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROUTE_ZOOM,
  hasRoute,
  MAX_ROUTE_POINTS,
  MAX_ROUTE_ZOOM,
  MIN_ROUTE_ZOOM,
  parseRoutePoints,
  parseRouteZoom,
  routeMapQuery,
  routePathD,
} from "./dive-site-route";

describe("parsing waypoints", () => {
  it("keeps a well-formed route as it was drawn", () => {
    const points = [
      { x: 16, y: 67 },
      { x: 44, y: 29 },
    ];
    expect(parseRoutePoints(points)).toEqual(points);
  });

  it("reads the JSON string the editor's hidden input posts", () => {
    expect(parseRoutePoints('[{"x":10,"y":20},{"x":30,"y":40}]')).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
  });

  it("treats anything unparseable as no route rather than throwing", () => {
    // A form post is untrusted input, and a settings page that 500s because
    // somebody sent `routePoints=hello` is worse than one that saves no route.
    for (const raw of ["hello", "", "{}", null, undefined, 42, [1, 2, 3], [{ x: "a", y: 1 }]]) {
      expect(parseRoutePoints(raw)).toEqual([]);
    }
  });

  it("drops a point with a non-finite coordinate", () => {
    expect(
      parseRoutePoints([
        { x: Number.NaN, y: 5 },
        { x: 10, y: 20 },
      ]),
    ).toEqual([{ x: 10, y: 20 }]);
  });

  it("clamps a coordinate into the frame instead of letting it draw outside", () => {
    expect(parseRoutePoints([{ x: -40, y: 180 }])).toEqual([{ x: 0, y: 100 }]);
  });

  it("caps a route at the maximum, so one stuck finger can't store a blob", () => {
    const many = Array.from({ length: MAX_ROUTE_POINTS + 20 }, (_unused, index) => ({
      x: index,
      y: index,
    }));
    expect(parseRoutePoints(many)).toHaveLength(MAX_ROUTE_POINTS);
  });

  it("rounds away precision no one can click", () => {
    expect(parseRoutePoints([{ x: 12.34567, y: 65.4321 }])).toEqual([{ x: 12.35, y: 65.43 }]);
  });
});

describe("parsing zoom", () => {
  it("takes the editor's string", () => {
    expect(parseRouteZoom("17")).toBe(17);
  });

  it("clamps outside the range the editor can draw at", () => {
    expect(parseRouteZoom(2)).toBe(MIN_ROUTE_ZOOM);
    expect(parseRouteZoom(99)).toBe(MAX_ROUTE_ZOOM);
  });

  it("falls back to the default for nonsense", () => {
    for (const raw of ["", "abc", null, undefined, Number.NaN]) {
      expect(parseRouteZoom(raw)).toBe(DEFAULT_ROUTE_ZOOM);
    }
  });
});

describe("whether there is a route to draw", () => {
  it("needs at least two points — one click is a dot, not a path", () => {
    expect(hasRoute([])).toBe(false);
    expect(hasRoute([{ x: 10, y: 10 }])).toBe(false);
    expect(
      hasRoute([
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ]),
    ).toBe(true);
  });
});

describe("the drawn path", () => {
  it("is empty below two points, so the briefing draws no <path> at all", () => {
    expect(routePathD([])).toBe("");
    expect(routePathD([{ x: 10, y: 10 }])).toBe("");
  });

  it("starts at the first waypoint and ends at the last", () => {
    const d = routePathD([
      { x: 16, y: 67 },
      { x: 44, y: 29 },
      { x: 84, y: 78 },
    ]);
    expect(d.startsWith("M 16 67")).toBe(true);
    expect(d.endsWith("84 78")).toBe(true);
  });

  it("emits one curve segment per gap between waypoints", () => {
    const four = routePathD([
      { x: 10, y: 10 },
      { x: 30, y: 20 },
      { x: 50, y: 40 },
      { x: 70, y: 30 },
    ]);
    expect(four.match(/C /g)).toHaveLength(3);
  });

  it("passes through every waypoint, so the line stays on the reef that was clicked", () => {
    // The curve is smoothed, but a Catmull-Rom spline is an interpolating one:
    // each clicked point is an endpoint of a segment, never merely near it.
    const points = [
      { x: 12, y: 80 },
      { x: 40, y: 25 },
      { x: 66, y: 55 },
    ];
    const d = routePathD(points);
    for (const point of points) {
      expect(d).toContain(`${point.x} ${point.y}`);
    }
  });
});

describe("the map frame a route is drawn against", () => {
  it("is the site's own coordinates, not its name", () => {
    expect(routeMapQuery({ forecastLatitude: 25.0117, forecastLongitude: -80.3764 })).toBe(
      "25.0117,-80.3764",
    );
  });

  it("is null when the site has no point — a frame nobody can reproduce draws nothing", () => {
    expect(routeMapQuery({ forecastLatitude: null, forecastLongitude: -80.3764 })).toBeNull();
    expect(routeMapQuery({ forecastLatitude: 25.0117, forecastLongitude: null })).toBeNull();
    expect(routeMapQuery({ forecastLatitude: null, forecastLongitude: null })).toBeNull();
  });
});
