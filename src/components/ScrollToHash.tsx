"use client";

import { useEffect } from "react";

/**
 * Scrolls to the anchor the page was opened at, after the anchor exists.
 *
 * A hard navigation to `/page#thing` runs the browser's own fragment
 * navigation and scrolls for you. A Next.js `<Link>` transition does not: it is
 * a client-side route change, and by the time the target row has rendered the
 * router has already decided where to leave the scroll position — so the page
 * lands at the top with the anchor a thousand pixels below the fold. That is
 * the same gap `AutoOpenDetails` closes for a collapsed `<details>`; this is
 * the scroll half of it.
 *
 * Render it *inside* the list that owns the anchors, so mounting is itself the
 * proof that the target is in the DOM.
 *
 * It runs once, on mount, and only when the hash is already there — never on a
 * later hash change, because from then on the browser's own in-page anchor
 * handling is working normally and a second scroll would fight it.
 *
 * **It says when it has finished**, by stamping `data-hash-landed` on the
 * document element — set in every branch, including the ones that scroll
 * nothing, so a reader waiting on it is never waiting forever. The visual
 * capture harness is that reader: a fragment-opened page is scrolled twice,
 * once by the browser's own fragment navigation and once here, and a
 * full-page screenshot taken between the two paints its `position: fixed`
 * chrome wherever the page happened to be (issue #1304). One attribute is
 * cheaper than the harness guessing.
 */
export const HASH_LANDED_ATTRIBUTE = "data-hash-landed";

export function ScrollToHash() {
  useEffect(() => {
    // Stamped on the way out of every branch below rather than at each return:
    // a marker that is only set on the interesting path is a marker a waiter
    // hangs on for the boring one.
    const landed = () => document.documentElement.setAttribute(HASH_LANDED_ATTRIBUTE, "true");
    const { hash } = window.location;
    if (!hash || hash.length < 2) return landed();
    let target: Element | null = null;
    try {
      target = document.querySelector(hash);
    } catch {
      // A hash that isn't a valid selector is somebody else's fragment, not an
      // anchor of ours — nothing to scroll to, and nothing to report.
      return landed();
    }
    if (!target) return landed();
    // `scroll-mt-*` on the target is what keeps it clear of the sticky header;
    // "start" is what honours it.
    target.scrollIntoView({ block: "start", behavior: "instant" });
    landed();
  }, []);

  return null;
}
