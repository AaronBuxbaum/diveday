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
