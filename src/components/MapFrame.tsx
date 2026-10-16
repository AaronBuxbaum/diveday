"use client";

import { useEffect, useRef, useState } from "react";
import { MAP_REACHABILITY_PROBE } from "@/lib/maps";

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
  const [reachable, setReachable] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);

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

  useEffect(() => {
    if (!onScreen) return;
    let settled = false;
    let probe: HTMLImageElement | null = null;
    // A blocked host errors at once; a stalled one never answers. The silence
    // is the only signal for the second, so it is read as failure, and an
    // answer that comes late still wins.
    const giveUp = setTimeout(() => {
      if (!settled) setGaveUp(true);
    }, MAP_GIVE_UP_MS);
    const ask = () => {
      window.removeEventListener("online", ask);
      probe = new Image();
      // Google learns that something asked, never which page.
      probe.referrerPolicy = "no-referrer";
      probe.onload = () => {
        if (!settled) {
          setReachable(true);
          setGaveUp(false);
        }
      };
      // Said, not left to a missing handler: the frame stays hidden.
      probe.onerror = () => {
        if (!settled) {
          setReachable(false);
          setGaveUp(true);
        }
      };
      probe.src = MAP_REACHABILITY_PROBE;
    };
    // With the radio off, ask once the signal comes back (a boat leaving the
    // dock with the page already open), never in a loop.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      window.addEventListener("online", ask);
    } else {
      ask();
    }
    return () => {
      settled = true;
      clearTimeout(giveUp);
      window.removeEventListener("online", ask);
      if (probe) {
        probe.onload = null;
        probe.onerror = null;
      }
    };
  }, [onScreen]);
  return (
    <iframe
      ref={frameRef}
      title={title}
      src={src}
      tabIndex={interactive ? undefined : -1}
      aria-hidden={reachable ? undefined : true}
      data-map-reachable={reachable ? "true" : "false"}
      data-map-state={reachable ? "reachable" : gaveUp ? "failed" : "waiting"}
      className={`${className}${reachable ? "" : " invisible"}`}
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}
