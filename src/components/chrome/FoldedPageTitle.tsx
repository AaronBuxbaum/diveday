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
  //
  // **And it waits for a slot that is not there yet**, which a single lookup
  // did not. `ShopChrome` — which composes `ShopNav`, which renders the slot —
  // sits behind the staff layout's `<Suspense>` (ADR
  // 20260804-instant-navigation), and this component is rendered by the *page*
  // on the other side of that boundary. So there is an ordering where the page
  // hydrates while the chrome is still its skeleton: the lookup found nothing,
  // the effect never ran again, and the bar silently lost its folding title for
  // the life of that page view. Not a paint later than it should be — never.
  //
  // Found as a one-in-six flake in `e2e/staff-nav.spec.ts`, where the slot
  // stayed empty for the whole of the assertion's budget rather than filling
  // late, which is what said it was an ordering rather than a slow hydration.
  useEffect(() => {
    const find = () => document.querySelector("[data-chrome-title-slot]");
    const onMount = find();
    if (onMount) {
      setSlot(onMount);
      return;
    }
    // Disconnected on the first hit, so this observes only across the gap
    // between the page hydrating and the chrome resolving.
    const observer = new MutationObserver(() => {
      const late = find();
      if (!late) return;
      observer.disconnect();
      setSlot(late);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return slot ? createPortal(title, slot) : null;
}
