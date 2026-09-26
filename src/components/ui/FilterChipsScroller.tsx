"use client";

import { type ReactNode, useLayoutEffect, useRef } from "react";

/**
 * **FilterChips' row, which brings the current chip on screen when it
 * arrives** (docs/design/pixel-craft.md, class 10).
 *
 * On a phone the row scrolls sideways and always opened at its start, so a
 * view whose chip sits past the screen's edge loaded with nothing saying which
 * view it is: the divers roster's "Deleted" is its fifth chip, at 536–620px in
 * a 390px row, and the gear register drops its list headings because the
 * current chip names the view. Once laid out, and whenever the current chip
 * changes (back and forward change it without a click), the row scrolls so
 * that chip starts at the row's inline-start padding.
 *
 * It sets the row's own `scrollLeft`. `scrollIntoView` would also scroll the
 * page to reach the row, and these rows sit above the lists they narrow with
 * `scroll={false}` precisely so a view change never moves the page. A row that
 * does not scroll, or whose current chip is already whole on screen, is left
 * where it is. Measured from the rendered boxes, so a right-to-left row (whose
 * `scrollLeft` runs from 0 to negative) scrolls toward its own start.
 *
 * The only client code in the chip row: the chips stay server-rendered links.
 */
export function FilterChipsScroller({
  activeKey,
  className,
  children,
}: {
  /** The current chip's key: the row scrolls again when it changes. */
  activeKey: string | undefined;
  className: string;
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `activeKey` is the trigger — the chip it names is found in the DOM, not read from the value.
  useLayoutEffect(() => {
    const el = row.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const active = el.querySelector<HTMLElement>('[aria-current="true"]');
    if (!active) return;

    const style = getComputedStyle(el);
    const rtl = style.direction === "rtl";
    const padStart = Number.parseFloat(style.paddingInlineStart) || 0;
    const padEnd = Number.parseFloat(style.paddingInlineEnd) || 0;
    const box = el.getBoundingClientRect();
    const chip = active.getBoundingClientRect();
    const innerLeft = box.left + el.clientLeft;
    const innerRight = innerLeft + el.clientWidth;

    // Where the chip starts, measured from the row's inline-start edge as the
    // row is scrolled now.
    const fromStart = rtl ? innerRight - chip.right : chip.left - innerLeft;
    if (fromStart >= padStart && fromStart + chip.width <= el.clientWidth - padEnd) return;

    const target = Math.abs(el.scrollLeft) + fromStart - padStart;
    el.scrollLeft = rtl ? -target : target;
  }, [activeKey]);

  return (
    <div ref={row} className={className}>
      {children}
    </div>
  );
}
