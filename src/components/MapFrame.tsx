"use client";

import { useEffect, useState } from "react";
import { MAP_REACHABILITY_PROBE } from "@/lib/maps";

/**
 * The map frame behind a drawn route, shown only once the provider has
 * answered (UX review 2026-10-10, item 20). Until then, and for good when it
 * cannot be reached (no signal on a boat, a network that blocks the host), the
 * frame stays invisible and the route draws alone over the panel's own
 * surface: no broken-document glyph under the line. `invisible`, never
 * unmounted, so the frame's box and the route's percentages never move.
 */
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
  const [reachable, setReachable] = useState(false);
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    let settled = false;
    const probe = new Image();
    // Google learns that something asked, never which page.
    probe.referrerPolicy = "no-referrer";
    probe.onload = () => {
      if (!settled) setReachable(true);
    };
    probe.src = MAP_REACHABILITY_PROBE;
    return () => {
      settled = true;
      probe.onload = null;
    };
  }, []);
  return (
    <iframe
      title={title}
      src={src}
      tabIndex={interactive ? undefined : -1}
      aria-hidden={reachable ? undefined : true}
      data-map-reachable={reachable ? "true" : "false"}
      className={`${className}${reachable ? "" : " invisible"}`}
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}
