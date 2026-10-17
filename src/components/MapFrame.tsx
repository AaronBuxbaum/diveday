"use client";

import { useEffect, useRef, useState } from "react";
import { useMapState } from "./use-map-reachable";

/**
 * The map frame behind a drawn route, shown only once the provider has
 * answered (UX review 2026-10-10, item 20). Until then, and for good when it
 * cannot be reached (no signal on a boat, a network that blocks the host), the
 * frame stays invisible and the route draws alone over the panel's own
 * surface: no broken-document glyph under the line. `invisible`, never
 * unmounted, so the frame's box and the route's percentages never move.
 *
 * **It says which of three it is** (`data-map-state`, issue #2013): `waiting`
 * until the provider answers, `reachable`, or `failed` once the probe errors or
 * {@link MAP_GIVE_UP_MS} pass with no answer. A cross-origin frame gives no
 * reliable `onError`, so the probe's error and the timeout are the only
 * signals there are. A surface that wants a line for the failed state asks the
 * document for it (`group-has-[[data-map-state=failed]]`) rather than lifting
 * this state, so the line can sit outside a scaled or cropped box.
 */

/** How long a map may stay silent before it counts as not loading. */
export const MAP_GIVE_UP_MS = 8000;

export function MapFrame({
  title,
  src,
  className,
  interactive,
}: {
  title: string;
  src: string;
  className: string;
  interactive: boolean;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
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
    <iframe
      ref={frameRef}
      title={title}
      src={src}
      tabIndex={interactive ? undefined : -1}
      aria-hidden={reachable ? undefined : true}
      data-map-reachable={reachable ? "true" : "false"}
      data-map-state={state}
      className={`${className}${reachable ? "" : " invisible"}`}
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}
