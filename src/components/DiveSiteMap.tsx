import type { DiverTranslator } from "@/i18n/messages";
import { hasRoute, type RoutePoint, routeMapQuery, routePathD } from "@/lib/dive-site-route";
import { googleMapsUrl, googleSatelliteEmbedUrl } from "@/lib/maps";

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
 * A dive site's satellite frame with the shop's own route drawn over it.
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

  return (
    <figure className="overflow-hidden border-b border-border bg-surface-sunken">
      <div className="relative h-64 overflow-hidden sm:h-80">
        <iframe
          title={t("site.satelliteMapTitle", { site: site.name })}
          src={googleSatelliteEmbedUrl(query, site.routeZoom)}
          className="absolute inset-0 h-full w-full"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
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
            strokeWidth="2.25"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={start.x}
            cy={start.y}
            r="2.4"
            fill="var(--primary)"
            stroke="var(--surface)"
            strokeWidth="1.1"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={finish.x}
            cy={finish.y}
            r="2.4"
            fill="var(--accent)"
            stroke="var(--surface)"
            strokeWidth="1.1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-surface/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm">
          {t("site.satelliteViewIllustrative")}
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
