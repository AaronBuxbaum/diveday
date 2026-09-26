import type { RoutePoint } from "@/lib/dive-site-route";

/**
 * **A waypoint on a drawn route: a dot, round in any frame** — the staff route
 * editor's waypoints and the briefing's start and finish.
 *
 * A route's line is drawn in a `0 0 100 100` SVG box stretched over the map
 * with `preserveAspectRatio="none"`, because its points are percentages of
 * the frame (`src/lib/dive-site-route.ts`), and that is right for a line. It is
 * wrong for a circle: stretched with the box, the editor's `r="2.4"` rendered
 * a 33×14px oval over a 698×288 frame (docs/design/pixel-craft.md, class 2;
 * K-413). So a waypoint is a box of its own, laid over the same frame at the
 * same percentages and centred on its point, its size in pixels.
 *
 * Lay it in the positioned box the route's SVG fills. `pointer-events-none`,
 * because the editor's click surface sits under it and a click on a dot still
 * places the next one. `className` is the dot's fill and ring colours.
 *
 * `magnified` is for a dot inside a box a transform enlarges — the briefing's
 * crop on its route — and divides it back out, so the dot is the size it says
 * and the crop moves only where it sits.
 */
export function RouteWaypoint({
  point,
  className,
  magnified = 1,
}: {
  point: RoutePoint;
  className: string;
  magnified?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${className}`}
      style={{
        left: `${point.x}%`,
        top: `${point.y}%`,
        scale: magnified === 1 ? undefined : String(1 / magnified),
      }}
    />
  );
}
