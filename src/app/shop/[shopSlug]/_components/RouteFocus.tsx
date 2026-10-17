"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** The staff main region the shell renders `{children}` into (`../layout.tsx`). */
export const SHOP_MAIN_ID = "shop-main-content";

/**
 * Whether the element is rendered. `cacheComponents` keeps the route a
 * staffer just left mounted, hidden by React's `<Activity>` with an inline
 * `display: none`, so "the page's h1" is the h1 with no such ancestor.
 */
function visible(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node instanceof HTMLElement && node.hidden) return false;
    if (getComputedStyle(node).display === "none") return false;
  }
  return true;
}

/** The new page's own heading, or null while only its skeleton is painted. */
function visibleHeading(main: HTMLElement): HTMLElement | null {
  for (const h1 of main.querySelectorAll<HTMLElement>("h1")) {
    if (visible(h1)) return h1;
  }
  return null;
}

/**
 * Something in the new page already took focus (an `autoFocus` field), and
 * moving it would undo the page's own choice.
 */
function pageOwnsFocus(main: HTMLElement): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement && active !== main && main.contains(active) && visible(active)
  );
}

function focusHeading(h1: HTMLElement): void {
  if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
  // A heading is not a control: no ring around it. The next Tab starts after it.
  h1.classList.add("outline-none");
  h1.focus({ preventScroll: true });
}

/**
 * **Where focus goes after a staff route change** (#2638, decided 2026-10-16).
 *
 * Following a link leaves focus on the anchor, and the client router keeps
 * the old route mounted but hidden, so Chromium answered a keyboard user's
 * next Tab by restarting from the top of the document. Now a change of
 * pathname moves focus to the new page's `h1`, which a screen reader reads
 * out as the page's name, or to `#shop-main-content` while the page has no
 * heading yet; the heading takes it when it streams in, unless focus has
 * moved on. A query-string change (a tab, a filter, a pager) keeps the same
 * pathname and moves nothing, and the first load moves nothing either: the
 * skip link stays the first stop.
 */
export function RouteFocus() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    if (from === null || from === pathname) return;
    const main = document.getElementById(SHOP_MAIN_ID);
    if (!main || pageOwnsFocus(main)) return;

    const h1 = visibleHeading(main);
    if (h1) {
      focusHeading(h1);
      return;
    }
    main.focus({ preventScroll: true });
    const observer = new MutationObserver(() => {
      if (document.activeElement !== main) {
        observer.disconnect();
        return;
      }
      const arrived = visibleHeading(main);
      if (!arrived) return;
      observer.disconnect();
      focusHeading(arrived);
    });
    observer.observe(main, { childList: true, subtree: true, attributes: true });
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
