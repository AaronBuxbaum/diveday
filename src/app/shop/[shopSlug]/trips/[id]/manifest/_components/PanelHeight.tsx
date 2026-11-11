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
 * Publishes the pinned count card's measured height on the rows' common parent
 * so roll-call targets can clear it.
 *
 * The card's content determines its height, so a `ResizeObserver` writes its
 * border-box height as `--roll-call-panel-h` on the shared parent. Rows use a
 * CSS fallback before observation and in browsers without `ResizeObserver`.
 *
 * It renders the `<section>` directly because a wrapper breaks sticky
 * positioning. `SummaryPanel` stays flat, and its children remain
 * server-rendered.
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
    const write = (observedHeight = card.getBoundingClientRect().height) => {
      const naturalHeight = Math.max(observedHeight, card.scrollHeight);
      const viewport = Math.min(
        window.innerHeight,
        window.visualViewport?.height ?? window.innerHeight,
      );
      // A panel taller than the usable viewport must not cover boarding
      // targets or conceal the count in a nested scroller. Leave the entire
      // panel in ordinary page flow in that case (ADR 20260907-in-your-hands,
      // 19d). This also covers zoom/keyboard viewports with a 16px root.
      const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      // One 3.5rem boat target plus its existing 1rem scroll clearance.
      const rowRoom = Math.max(44, rootSize * 4.5);
      // Desktop chrome still occupies the panel's resolved sticky inset.
      // Budget the space below that inset, not the whole viewport.
      const pinnedTop = Math.max(0, Number.parseFloat(getComputedStyle(card).top) || 0);
      const flows = naturalHeight > viewport - pinnedTop - rowRoom;
      card.style.position = flows ? "static" : "";
      if (flows) card.setAttribute("data-roll-call-panel-flow", "true");
      else card.removeAttribute("data-roll-call-panel-flow");
      column.style.setProperty(
        ROLL_CALL_PANEL_HEIGHT_VAR,
        flows ? "0px" : `${Math.ceil(observedHeight)}px`,
      );
    };
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      write(entry?.borderBoxSize?.[0]?.blockSize ?? card.getBoundingClientRect().height);
    });
    const resize = () => write();
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    observer.observe(card, { box: "border-box" });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      card.style.removeProperty("position");
      card.removeAttribute("data-roll-call-panel-flow");
      column.style.removeProperty(ROLL_CALL_PANEL_HEIGHT_VAR);
    };
  }, []);

  return (
    <section
      ref={ref}
      aria-labelledby={labelledBy}
      className={className}
      // The touch cue's line sits just under this card (issue #2328):
      // `ROLL_CALL_PANEL_ATTRIBUTE`, which `PanelHeight.test.tsx` ties to this.
      data-roll-call-panel=""
    >
      {children}
    </section>
  );
}
