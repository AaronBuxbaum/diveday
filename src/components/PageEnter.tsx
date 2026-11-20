"use client";

import { type ReactNode, useLayoutEffect } from "react";

/**
 * Whether this tab has already shown a page. The first paint of a visit never
 * animates (it is the page arriving from the network, not a move), so a first
 * load, a screenshot and a crawler all see the page at rest; every page the
 * person then moves to rises in softly. Module state is deliberate: a template
 * remounts on each navigation, and nothing should carry across tabs.
 */
let hasShownAPage = false;

/** `--motion-quick` in `globals.css`. */
const RISE_MS = 150;

/**
 * **A move between pages rises in** (issue #4263): `rise-in`'s own fade and
 * eight pixels of travel, in the quick beat, so a tap lands somewhere rather
 * than swapping. It plays on the page's own content container (`targetId`) and
 * renders no element of its own: a wrapper between the layout and the page broke
 * the child-combinator rules the roll call's boat mode and pinned count card
 * read (`#shop-main-content > main > …`). Opacity and transform only, no fill
 * once it settles (a transform that stayed would become the containing block of
 * every fixed bar and toast), and reduced motion plays nothing.
 */
export function PageEnter({ targetId, children }: { targetId: string; children: ReactNode }) {
  useLayoutEffect(() => {
    const shown = hasShownAPage;
    hasShownAPage = true;
    if (!shown) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.getElementById(targetId)?.animate(
      [
        { opacity: 0, transform: "translateY(0.5rem)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: RISE_MS, easing: "ease-out", fill: "backwards" },
    );
  }, [targetId]);
  return <>{children}</>;
}
