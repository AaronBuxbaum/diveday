"use client";

import { useEffect } from "react";
import { SCROLL_SETTLED_ATTRIBUTE } from "@/components/PreserveFormScroll";

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
const HASH_LANDED_ATTRIBUTE = "data-hash-landed";

/**
 * **The reader wins** (CI on PR #4674, three specs in three runs): a page body
 * hydrates after its header, so a tap can land between the page painting and
 * these effects running. Scrolling then moves the page under that tap and it
 * lands on whatever slid beneath the finger. So the page is moved at most once
 * per address, by the first list holding the anchor, and never once the reader
 * has touched, scrolled or typed on that same address. The tap that brought
 * them here was made on the page before, so it does not count.
 */
let touchedAt: string | null = null;
let landedAt: string | null = null;
if (typeof window !== "undefined") {
  const touched = () => {
    touchedAt = window.location.href;
  };
  for (const kind of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    window.addEventListener(kind, touched, { capture: true, passive: true });
  }
}

function mayMoveThePage(): boolean {
  const here = window.location.href;
  return touchedAt !== here && landedAt !== here;
}

export function ScrollToHash({
  onlyHash,
  focusSelector,
}: {
  /** A form can opt in to its own fragment without changing other landings. */
  onlyHash?: string;
  /** Explicit fragment navigation may put the cursor inside its target. */
  focusSelector?: string;
} = {}) {
  useEffect(() => {
    // Stamped on the way out of every branch below rather than at each return:
    // a marker that is only set on the interesting path is a marker a waiter
    // hangs on for the boring one.
    const landed = () => document.documentElement.setAttribute(HASH_LANDED_ATTRIBUTE, "true");
    const { hash } = window.location;
    if (!hash || hash.length < 2) return landed();
    if (onlyHash && hash !== `#${onlyHash}`) return landed();
    let target: Element | null = null;
    try {
      target = document.querySelector(hash);
    } catch {
      // A hash that isn't a valid selector is somebody else's fragment, not an
      // anchor of ours — nothing to scroll to, and nothing to report.
      return landed();
    }
    if (!target) return landed();
    if (focusSelector) {
      const field = target.querySelector<HTMLElement>(focusSelector);
      if (!field) return landed();
      // AutoOpenDetails opens in a sibling effect. Wait until its contents
      // are drawn and route scroll restoration has finished before landing.
      let frame = 0;
      let frames = 0;
      let lastY = Number.NaN;
      let stillFrames = 0;
      const reveal = () => {
        if (window.location.hash !== hash) return landed();
        const rendered = typeof field.checkVisibility !== "function" || field.checkVisibility();
        const settled = document.documentElement.hasAttribute(SCROLL_SETTLED_ATTRIBUTE);
        stillFrames = window.scrollY === lastY ? stillFrames + 1 : 0;
        lastY = window.scrollY;
        if (!rendered || !settled || stillFrames < 2) {
          if (frames++ < 60) frame = requestAnimationFrame(reveal);
          else landed();
          return;
        }
        if (!mayMoveThePage()) return landed();
        landedAt = window.location.href;
        field.focus({ preventScroll: true });
        target.scrollIntoView({ block: "start", behavior: "instant" });
        landed();
      };
      frame = requestAnimationFrame(reveal);
      return () => cancelAnimationFrame(frame);
    }
    // `scroll-mt-*` on the target is what keeps it clear of the sticky header;
    // "start" is what honours it.
    if (!mayMoveThePage()) return landed();
    const href = window.location.href;
    landedAt = href;
    target.scrollIntoView({ block: "start", behavior: "instant" });
    landed();
    // Leaving the page lets a later visit to the same address land again.
    return () => {
      if (landedAt === href) landedAt = null;
    };
  }, [onlyHash, focusSelector]);

  return null;
}
