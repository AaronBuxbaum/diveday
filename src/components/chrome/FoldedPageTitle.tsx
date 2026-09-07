"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * **The page's title, delivered into the shell's bar** — ADR
 * 20260907-nothing-from-nowhere, decision 5.
 *
 * The fold needs the page's own title inside the 56px chrome bar, and in this
 * app the two live in different trees: `ChromeBar` is composed by `ShopNav` in
 * the shop *layout*, and the title is `ShopPageHeader`, rendered by the *page*.
 * A layout cannot read its page's props, so no arrangement of CSS alone can put
 * one inside the other (issue #1422).
 *
 * A portal was the smaller of the two answers. The alternative — a title slot
 * on the layout — needs a mechanism (a context, a parallel route, a per-page
 * export) plus a decision about what a page with no title renders, which is a
 * change to the shell's shape for a motion slice. This leaves the layout alone.
 *
 * **The slot's absence is the storefront's gate.** `ShopPageHeader` also serves
 * ten-plus surfaces under `src/app/s/`, and the ADR is explicit that the public
 * storefront does not fold. `PublicShopChrome` renders no
 * `[data-chrome-title-slot]`, so there is nothing to portal into and this
 * renders nothing — deliberately, and pinned by `chrome.test.ts` rather than
 * left as something that happens to be true.
 *
 * The label is `aria-hidden` on the slot itself: it is a second copy of a
 * heading the page already renders, so a screen reader must not meet it twice,
 * and the bar's accessible name stays the shop's.
 */
export function FoldedPageTitle({ title }: { title: string }) {
  const [slot, setSlot] = useState<Element | null>(null);

  // After mount, because the target is in the DOM rather than in this tree.
  // The slot lives in the layout, so it survives a client navigation and this
  // re-finds it anyway — cheap, and correct if a shell ever remounts it.
  useEffect(() => {
    setSlot(document.querySelector("[data-chrome-title-slot]"));
  }, []);

  return slot ? createPortal(title, slot) : null;
}
