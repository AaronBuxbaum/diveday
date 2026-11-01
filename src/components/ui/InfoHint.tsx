"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";

/** Gap between the trigger and the panel, and the panel's margin to the viewport edge. */
const PANEL_GAP = 8;
const VIEWPORT_MARGIN = 16;
/** Matches the `w-72` below — read here so the clamp and the class agree. */
const PANEL_WIDTH = 288;

/**
 * A compact, accessible hint for details that belong beside a field but need
 * not stay on screen. It opens on hover, focus, or tap. The description stays
 * in the DOM for `aria-describedby`, and its button never submits a containing
 * form.
 *
 * The panel is portalled to `document.body` and positioned from the visible
 * glyph, then clamped and flipped within the viewport. This avoids transformed
 * `<details>` ancestors and prevents hidden overflow from widening the page.
 */
export function InfoHint({
  label,
  detail,
  className = "",
}: {
  /** Accessible name for the trigger, e.g. "About the depth unit". */
  label: string;
  /** The explanation itself. */
  detail: string;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  // Keep the described node in server HTML; portal it after hydration when
  // `document` is available.
  const [portalled, setPortalled] = useState(false);
  useEffect(() => setPortalled(true), []);
  // Until placed, keep the invisible panel out of flow to avoid a first-paint flash.
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    // The button box matches the 20px glyph; its 44px hit target is a stretched
    // `::after`, excluded from the rect, so placement follows the visible mark.
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    // Align to the trigger when possible and clamp both edges to the viewport.
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN),
    );
    // Place below the marker unless the panel would cross the bottom margin.
    const below = rect.bottom + PANEL_GAP;
    const estimatedHeight = Math.max(panelRef.current?.offsetHeight ?? 0, 64);
    const top =
      below + estimatedHeight > window.innerHeight - VIEWPORT_MARGIN
        ? Math.max(VIEWPORT_MARGIN, rect.top - PANEL_GAP - estimatedHeight)
        : below;
    setPosition({ left, top });
  }, []);

  const show = useCallback(() => {
    place();
    setOpen(true);
  }, [place]);
  const hide = useCallback(() => setOpen(false), []);

  // A `fixed` panel does not travel with the page, so anything that moves the
  // document under it dismisses it rather than leaving it stranded beside the
  // wrong control.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    window.addEventListener("resize", hide, { passive: true });
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [open, hide]);

  const panel = (
    <span
      key={id}
      ref={panelRef}
      id={id}
      role="note"
      style={position ? { left: position.left, top: position.top } : undefined}
      // Match other floating surfaces and stay above sticky chrome.
      className={`pointer-events-none fixed top-0 left-0 z-50 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed font-normal text-muted shadow-lg transition-opacity ${
        open && position ? "visible opacity-100" : "invisible opacity-0"
      }`}
    >
      {detail}
    </span>
  );

  return (
    <span className={`inline-flex align-middle ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-controls={id}
        aria-expanded={open}
        onClick={() => (open ? hide() : show())}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        // Keep the 20px glyph inside a 44px target without adding line height;
        // the focus ring surrounds the glyph's box (pixel-craft class 7,
        // issue #786; `focus-ring.test.ts` protects the shared ring).
        className="relative inline-flex size-5 items-center justify-center rounded-full text-muted transition-colors after:absolute after:-inset-3 after:rounded-full after:content-[''] hover:text-primary focus-visible:text-primary"
      >
        {/* An icon rather than a "?" glyph: a text marker is copy, and copy
            belongs in a message bundle. This one carries no language at all. */}
        <DiveDayIcon name="info" className="size-5 shrink-0" />
      </button>
      {portalled ? createPortal(panel, document.body) : panel}
    </span>
  );
}
