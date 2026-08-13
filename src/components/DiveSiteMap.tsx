import type { DiverTranslator } from "@/i18n/messages";
import {
  hasRoute,
  type RoutePoint,
  routeFocus,
  routeMapQuery,
  routePathD,
} from "@/lib/dive-site-route";
import { googleMapsUrl, googleTerrainEmbedUrl } from "@/lib/maps";
import { MapEmbed } from "./MapEmbed";

/** The slice of a dive site this draws — structural, so callers pass the row. */
export type DiveSiteRouteMap = {
  name: string;
  forecastLatitude: number | null;
  forecastLongitude: number | null;
  routePoints: RoutePoint[];
  routeLabel: string | null;
  routeNote: string | null;
  routeZoom: number;
};

/**
 * Whether a site has everything this needs to draw: coordinates for the frame,
 * and enough waypoints to be a path. Exported so a caller can decide between
 * this and a plain photo *before* rendering, which is what the trip briefing
 * does.
 */
export function canDrawRoute(site: DiveSiteRouteMap): boolean {
  return routeMapQuery(site) !== null && hasRoute(site.routePoints);
}

/**
 * A dive site's terrain frame with the shop's own route drawn over it.
 *
 * The route used to come from a lookup table of three hand-authored SVG paths
 * keyed by site name, which meant DiveDay's three demo sites had a map and no
 * real shop could ever have one. It comes off the site row now, drawn by the
 * staffer who knows the reef (`dive-sites/[id]` → the route editor), and the
 * three seeded ones are simply rows that carry a route like any other.
 *
 * The frame is the site's own coordinates at its stored zoom — never its name.
 * See `src/lib/dive-site-route.ts` for why that pairing is load-bearing rather
 * than a detail.
 */
export function DiveSiteMap({ site, t }: { site: DiveSiteRouteMap; t: DiverTranslator }) {
  const query = routeMapQuery(site);
  if (!query || !hasRoute(site.routePoints)) return null;
  const path = routePathD(site.routePoints);
  const start = site.routePoints[0];
  const finish = site.routePoints[site.routePoints.length - 1];
  // Crop in on the route itself. A shop draws on the whole frame — that is the
  // editor's rule — so a short swim around one mooring lands in the middle
  // fifth of a picture that is mostly open water. One transform on the wrapper
  // moves the embed and the SVG together, which is what keeps a percentage
  // pointing at the water it always pointed at (src/lib/dive-site-route.ts).
  const focus = routeFocus(site.routePoints);
  // The crop magnifies the overlay along with the map, so the line and its two
  // end dots are divided back out — a `non-scaling-stroke` is constant in the
  // SVG's own box, not in the scaled result, and 2.25 at 2.6x is a rope across
  // the reef rather than a route.
  const zoom = focus?.scale ?? 1;
  const strokeWidth = 2.25 / zoom;
  const markerRadius = 2.4 / zoom;
  const markerStroke = 1.1 / zoom;

  return (
    <figure className="overflow-hidden border-b border-border bg-surface-sunken">
      <div className="relative h-64 overflow-hidden sm:h-80">
        <div
          className="absolute inset-0 origin-top-left"
          style={
            focus
              ? {
                  transform: `translate(${focus.translateX}%, ${focus.translateY}%) scale(${focus.scale})`,
                }
              : undefined
          }
        >
          {/* Never pannable, for the same reason the staff route editor's own
              frame isn't (`dive-sites/_components/RouteEditor.tsx`): the route is
              an SVG in *frame* coordinates laid over this embed, so the instant a
              reader drags the map the drawn path stops describing the reef under
              it — the line stays put while the water moves. A diver reading a
              briefing has no way to tell they have done that, and nothing puts
              the frame back except a reload. Exploring the site for real is the
              "Open map" link in the caption, which opens Google Maps properly
              rather than a 256px-tall pretend one — which is also why `MapEmbed`
              can crop the provider's own controls away without taking anything
              from the reader. */}
          <MapEmbed
            title={t("site.terrainMapTitle", { site: site.name })}
            src={googleTerrainEmbedUrl(query, site.routeZoom)}
            className="h-full w-full"
          >
            <svg
              viewBox="0 0 100 100"
              className="pointer-events-none absolute inset-0 h-full w-full"
              aria-hidden="true"
              preserveAspectRatio="none"
            >
              <path
                d={path}
                fill="none"
                stroke="var(--accent)"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={strokeWidth}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={start.x}
                cy={start.y}
                r={markerRadius}
                fill="var(--primary)"
                stroke="var(--surface)"
                strokeWidth={markerStroke}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={finish.x}
                cy={finish.y}
                r={markerRadius}
                fill="var(--accent)"
                stroke="var(--surface)"
                strokeWidth={markerStroke}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </MapEmbed>
        </div>
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 text-sm sm:px-6">
        <div>
          {/* Both lines are the shop's own words about its own reef, so an
              absent one is simply absent — never a placeholder sentence
              DiveDay invented on its behalf. */}
          {site.routeLabel ? <p className="font-medium">{site.routeLabel}</p> : null}
          {site.routeNote ? <p className="mt-0.5 text-muted">{site.routeNote}</p> : null}
        </div>
        <a
          href={googleMapsUrl(query)}
          target="_blank"
          rel="noreferrer"
          className="min-h-11 shrink-0 content-center text-sm font-medium text-primary hover:underline"
        >
          {t("site.openMap")}
        </a>
      </figcaption>
    </figure>
  );
}
