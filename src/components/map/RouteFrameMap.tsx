"use client";

import type { Map as LeafletMap } from "leaflet";
import { useEffect, useRef, useState } from "react";
import { routeFrameBounds } from "@/lib/basemap";
import { createBasemapMap } from "./leaflet-basemap";

/**
 * **The still map a route is drawn on**: the same basemap as the dive-site
 * library (`createBasemapMap`), framed on the site at its stored route zoom and
 * never moved by a hand.
 *
 * A waypoint is a percentage of this box (`src/lib/dive-site-route.ts`), so the
 * frame is fixed: no dragging, no zooming, no keyboard. It is fitted to
 * {@link routeFrameBounds} at whole zooms, the fit the OpenStreetMap embed made
 * of the same box, so a route drawn over that embed still lies on its water;
 * and it is fitted again whenever its box changes, the way a fresh load at that
 * width would frame it.
 */
export function RouteFrameMap({
  title,
  latitude,
  longitude,
  zoom,
  className,
}: {
  title: string;
  latitude: number;
  longitude: number;
  zoom: number;
  className: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const initial = useRef({ latitude, longitude, zoom });

  useEffect(() => {
    let cancelled = false;
    let created: LeafletMap | null = null;
    import("leaflet").then((L) => {
      const container = containerRef.current;
      if (cancelled || !container) return;
      const start = initial.current;
      created = createBasemapMap(L, container, {
        center: [start.latitude, start.longitude],
        zoom: start.zoom,
        zoomSnap: 1,
        credit: false,
        zoomControl: false,
        dragging: false,
        touchZoom: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        fadeAnimation: false,
        zoomAnimation: false,
      });
      setMap(created);
    });
    return () => {
      cancelled = true;
      created?.remove();
      setMap(null);
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    const frameSite = () =>
      map.fitBounds(routeFrameBounds(latitude, longitude, zoom), { animate: false });
    frameSite();
    map.on("resize", frameSite);
    return () => {
      map.off("resize", frameSite);
    };
  }, [latitude, longitude, map, zoom]);

  return <div ref={containerRef} role="img" aria-label={title} className={className} />;
}
