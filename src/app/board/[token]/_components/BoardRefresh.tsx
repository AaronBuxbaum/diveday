"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Keeps a screen on a wall current without anyone touching it: re-renders
 * the board on a fixed interval, and again the moment a tablet that was
 * asleep is looked at. `router.refresh()` re-runs the server render, so a
 * revoked link turns into the 404 on its next tick — which is how "the screen
 * goes dark on its next refresh" is kept true.
 *
 * No words, no state, nothing in the DOM: a page that renders from the server
 * every minute needs no client copy of anything.
 */
export function BoardRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(refreshIfVisible, everyMs);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [router, everyMs]);
  return null;
}
