"use client";

import { useEffect, useRef, useState } from "react";
import { RouteFrameMap } from "./map/RouteFrameMap";
import { useMapState } from "./use-map-reachable";

/**
 * The map behind a drawn route (`RouteFrameMap`, the library's basemap held
 * still), shown only once the tile host has answered (UX review 2026-10-10,
 * item 20). Until then, and for good when it cannot be reached (no signal on a
 * boat, a network that blocks the host), the frame stays invisible and the
 * route draws alone over the panel's own surface: no half-painted tiles under
 * the line. `invisible`, never
 * unmounted, so the frame's box and the route's percentages never move.
 *
 * **It says which of three it is** (`data-map-state`, issue #2013): `waiting`
 * until the provider answers, `reachable`, or `failed` once the probe errors or
 * {@link MAP_GIVE_UP_MS} pass with no answer. A tile that cannot load paints
 * nothing and says nothing, so the probe's error and the timeout are the only
 * signals there are. A surface that wants a line for the failed state asks the
 * document for it (`group-has-[[data-map-state=failed]]`) rather than lifting
 * this state, so the line can sit outside a scaled or cropped box.
 */

/** How long a map may stay silent before it counts as not loading. */
export const MAP_GIVE_UP_MS = 8000;

export function MapFrame({
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
  /** Where the map sits; it fills this box. */
  className: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(false);

  // Nothing is asked until the frame is on screen: a map inside a folded
  // editor section (`display: none` below `lg`) never intersects, so opening
  // the editor on a phone contacts no one until that section is opened.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof IntersectionObserver === "undefined") {
      setOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      setOnScreen(true);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const state = useMapState(onScreen, MAP_GIVE_UP_MS);
  const reachable = state === "reachable";
  return (
    <div
      ref={frameRef}
      aria-hidden={reachable ? undefined : true}
      data-map-reachable={reachable ? "true" : "false"}
      data-map-state={state}
      className={`pointer-events-none ${className}${reachable ? "" : " invisible"}`}
    >
      {onScreen ? (
        <RouteFrameMap
          title={title}
          latitude={latitude}
          longitude={longitude}
          zoom={zoom}
          className="h-full w-full"
        />
      ) : null}
    </div>
  );
}
