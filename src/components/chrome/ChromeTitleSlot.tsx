"use client";

import { useEffect, useState } from "react";

/**
 * **Where the page's title lands when the bar folds** (ADR
 * 20260907-nothing-from-nowhere, decision 5), and the signal that it may.
 *
 * `FoldedPageTitle` portals into this span from the *page*, which hydrates on
 * its own schedule. Text portalled into the span while it is still the
 * server's markup is a foreign node React then meets mid-hydration: "Hydration
 * failed", and in production the whole shell is thrown away and client
 * rendered — which also closes any `<details>` a staffer opened in that window
 * (issue #2036; caught by the check-in no-show capture). So the slot says when
 * it is its own: `data-chrome-title-ready` appears from this effect, after the
 * span has hydrated, and the portal waits for it.
 *
 * Empty in the markup and `aria-hidden`, because it is a second copy of a
 * heading the page already renders and the bar's accessible name stays the
 * shop's. `max-w-0` at rest so the label costs the row nothing wherever the
 * fold does not run — no scroll-driven animations, `lg` and up, or a
 * reduced-motion reader — and the fold gives it the width the shop's name lets
 * go of.
 *
 * The shop name's own line box, `leading-6`: 24px, the name's 16px at the
 * body's 1.5. The row centres both boxes on the mark, and where a box's top
 * lands decides the pixel row its baseline snaps to — the name's starts on a
 * half pixel. The title's own box, 17px under `leading-none` and 25.5px
 * inherited, started on a whole one, and its cap sat 1px above the mark's
 * centre and the name it replaces (K-502).
 */
export function ChromeTitleSlot() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <span
      data-chrome-title-slot
      data-chrome-title-ready={ready ? "" : undefined}
      aria-hidden
      className="max-w-0 min-w-0 truncate text-[17px] leading-6 font-semibold tracking-tight opacity-0"
    />
  );
}
