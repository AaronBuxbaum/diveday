"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { HOUR_MS, MINUTE_MS } from "@/lib/clock";

/** How often a visible page re-reads itself. */
export const LIVE_REFRESH_INTERVAL_MS = MINUTE_MS;
/** A focus straight after a refresh does not ask again. */
export const LIVE_REFRESH_MIN_GAP_MS = 30 * 1000;
/**
 * With no tap or key for this long, the page stops re-reading itself, so an
 * unattended counter tablet's session can lapse (one working day; issue #2803).
 */
export const LIVE_REFRESH_IDLE_LIMIT_MS = 12 * HOUR_MS;

/** True while someone is typing into a field, which a refresh must not interrupt. */
export function isTyping(active: Element | null): boolean {
  if (active == null) return false;
  if (active instanceof HTMLElement && active.isContentEditable) return true;
  const tag = active.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * **The desk's page keeps itself current** (fifth loop, item 8). Today and
 * the check-in queue are left open on a counter tablet all morning, and a page
 * that only changes when someone pulls it reads as the morning it was opened
 * in. This re-reads the server's render when the tab comes back into view or
 * the window takes focus, and once a minute while it is visible.
 *
 * It never fires while a field has focus, so a refresh does not land in the
 * middle of a name being typed, and a hidden tab costs nothing. The page's own
 * "Updated" line is the server's clock at render, so it moves with each read.
 *
 * `holdAfterTapMs` also holds it off for that long after any tap: on the
 * check-in queue a refresh that reorders rows under a wet thumb can check in
 * the wrong person (review fixes, dive-domain N7).
 *
 * Each refresh is a request under the staffer's session, which renews it. So
 * after `LIVE_REFRESH_IDLE_LIMIT_MS` with no pointerdown or keydown it stops,
 * and a tablet left open overnight reaches session expiry like any other tab.
 * The next tap starts it again.
 */
export function LiveRefresh({ holdAfterTapMs = 0 }: { holdAfterTapMs?: number } = {}) {
  const router = useRouter();
  const last = useRef(0);

  useEffect(() => {
    last.current = performance.now();
    let lastTap = Number.NEGATIVE_INFINITY;
    let lastInput = last.current;
    const onTap = () => {
      lastTap = performance.now();
      lastInput = lastTap;
    };
    const onKey = () => {
      lastInput = performance.now();
    };
    const refresh = (force: boolean) => {
      if (document.visibilityState !== "visible") return;
      if (isTyping(document.activeElement)) return;
      const at = performance.now();
      if (at - lastInput >= LIVE_REFRESH_IDLE_LIMIT_MS) return;
      if (at - lastTap < holdAfterTapMs) return;
      if (!force && at - last.current < LIVE_REFRESH_MIN_GAP_MS) return;
      last.current = at;
      router.refresh();
    };
    const onVisible = () => refresh(false);
    const onFocus = () => refresh(false);
    const interval = setInterval(() => refresh(true), LIVE_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    document.addEventListener("pointerdown", onTap, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("pointerdown", onTap, true);
      document.removeEventListener("keydown", onKey, true);
      clearInterval(interval);
    };
  }, [router, holdAfterTapMs]);

  return null;
}
