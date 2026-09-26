"use client";

import { type ReactNode, useEffect, useRef } from "react";

/**
 * The custom property the pinned count card publishes its height on, and the
 * one `rollCallScrollMargin` (`RollCallControls.tsx`) reads. That file spells
 * it inside a Tailwind class, which has to be a literal for the scanner to see
 * it, so `RollCallControls.test.ts` ties the two spellings together.
 */
export const ROLL_CALL_PANEL_HEIGHT_VAR = "--roll-call-panel-h";

/**
 * **The manifest's pinned count card, telling the rows under it how tall it
 * is.**
 *
 * A roll-call row that one of the card's chips jumps to must land below the
 * card, or the name is buried under it and the next visible mark — somebody
 * else's — is what a crew member taps (dive-domain review 20260810). The
 * card's height is content: after a dive it carries up to three pinned danger
 * lines and the chips naming who is missing, and on a phone it stacks and
 * wraps each of them. It was written down as 15rem (240px) and measured
 * 342–426px at 390, so a jumped-to row landed at y 352 under a card reaching
 * to y 482 (pixel-craft class 9).
 *
 * So the card measures itself. A `ResizeObserver` writes its border-box height
 * as `--roll-call-panel-h` on the card's parent: the page's column, which is
 * also where the diver and crew rows sit, so every row inherits it. Until it
 * has run — a jump that lands before hydration, a browser without the
 * observer — the rows fall back to the written-down height.
 *
 * **It renders the `<section>` itself rather than wrapping it.** A sticky box
 * is pinned only while its containing block is on screen, and `SummaryPanel`
 * returns the card flat for exactly that reason: a wrapper around it un-pinned
 * the card a few diver rows down. `SummaryPanel` is a server component, so
 * this is the smallest client boundary that can own the element — its
 * children stay server-rendered.
 */
export function PanelHeight({
  labelledBy,
  className,
  children,
}: {
  labelledBy: string;
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const card = ref.current;
    const column = card?.parentElement;
    if (!card || !column || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const height = entry?.borderBoxSize?.[0]?.blockSize ?? card.getBoundingClientRect().height;
      column.style.setProperty(ROLL_CALL_PANEL_HEIGHT_VAR, `${Math.ceil(height)}px`);
    });
    observer.observe(card, { box: "border-box" });
    return () => {
      observer.disconnect();
      column.style.removeProperty(ROLL_CALL_PANEL_HEIGHT_VAR);
    };
  }, []);

  return (
    <section ref={ref} aria-labelledby={labelledBy} className={className}>
      {children}
    </section>
  );
}
