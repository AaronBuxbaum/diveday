"use client";

import { type ReactNode, useEffect, useState } from "react";

/**
 * Whether this tab has already shown a page. The first paint of a visit never
 * animates (it is the page arriving from the network, not a move), so a first
 * load, a screenshot and a crawler all see the page at rest; every page the
 * person then moves to rises in softly. Module state is deliberate: a template
 * remounts on each navigation, and nothing should carry across tabs.
 */
let hasShownAPage = false;

/**
 * **A move between pages rises in** (issue #4263): `rise-in`'s own fade and
 * eight pixels of travel, in the quick beat, so a tap lands somewhere rather
 * than swapping. Opacity and transform only, no fill once it settles (a
 * transform that stayed would become the containing block of every fixed bar
 * and toast below it), and the reduced-motion switch in `globals.css` zeroes it.
 */
export function PageEnter({ children }: { children: ReactNode }) {
  const [animate] = useState(() => hasShownAPage);
  useEffect(() => {
    hasShownAPage = true;
  }, []);
  return <div className={animate ? "page-enter" : undefined}>{children}</div>;
}
