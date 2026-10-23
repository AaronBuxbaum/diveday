import type { ReactNode } from "react";
import { BASEMAP_CREDIT } from "@/lib/basemap";
import { MapFrame } from "./MapFrame";

/**
 * The still map a route is drawn over, with the basemap's credit in a band
 * below the drawing window.
 *
 * **The map is larger than its window, on purpose.** Routes stored before the
 * shared basemap were drawn over an OpenStreetMap embed that was inflated 4rem
 * past the window on the left, right and top and 4rem into the credit band
 * below, to crop the provider's own furniture; that embed fitted the site's
 * box to the inflated size. The map keeps exactly that box (`-top-16 -left-16`,
 * `calc(100% + 8rem)` wide, `calc(100% + 4rem)` tall), so it fits to the same
 * zoom and centre and a waypoint stored as a percentage of the window still
 * points at the water it always pointed at. Overlays are positioned against
 * the window, never the band.
 */
export function MapEmbed({
  title,
  latitude,
  longitude,
  zoom,
  className = "",
  children,
}: {
  title: string;
  latitude: number;
  longitude: number;
  /** The stored route zoom; the frame is fitted to the site's box at it. */
  zoom: number;
  /** Sizing and shape for the visible window, credit band included. */
  className?: string;
  /** Overlays drawn over the map — the route SVG, a click surface. */
  children?: ReactNode;
}) {
  // `bg-surface-sunken` is the ground under the map (issue #2013): the tiles
  // paint over it once loaded, and until then, or for good where the host is
  // blocked, the route still has a surface.
  return (
    <div className={`group/embed relative overflow-hidden bg-surface-sunken ${className}`}>
      <MapFrame
        title={title}
        latitude={latitude}
        longitude={longitude}
        zoom={zoom}
        className="absolute -top-16 -left-16 h-[calc(100%+4rem)] w-[calc(100%+8rem)]"
      />
      {/* The credit shows with the map it credits, never over a blocked one. */}
      <p className="pointer-events-none absolute end-0 bottom-0 hidden max-w-full truncate rounded-ss-inset bg-surface/90 px-1.5 py-0.5 text-xs text-muted group-has-[[data-map-state=reachable]]/embed:block">
        {BASEMAP_CREDIT}
      </p>
      <div className="absolute inset-x-0 top-0 h-[calc(100%-4rem)]">{children}</div>
    </div>
  );
}
