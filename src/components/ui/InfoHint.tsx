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
 * The "there is more to say, but not on the page" affordance.
 *
 * Settings cards had grown three- and four-sentence descriptions explaining
 * storage units, what a change does and does not convert, and which other
 * surfaces a value appears on. All of it is true and occasionally load-bearing,
 * and all of it was on screen permanently, so a shop scanning for the box it
 * came to change read four paragraphs first. The detail moves in here: a small
 * marker beside the heading, opened by hover, by keyboard focus, or by tap.
 *
 * Three deliberate details:
 *
 * - **The panel is always in the DOM**, hidden with `invisible`/`opacity-0`
 *   rather than unmounted. `aria-describedby` resolves against hidden nodes
 *   when they are referenced by id (accname §4.3.2), so the detail is part of
 *   the trigger's accessible description whether or not anything is hovering —
 *   a screen reader gets the full text on focus without opening anything.
 * - **Tap works.** `:focus-within` alone is unreliable on iOS for a button that
 *   is not a form control, so the trigger toggles state on click as well.
 * - **The trigger is a `<button type="button">`.** These live inside `<form>`
 *   elements on the settings page; the default `type` is `submit`, so leaving
 *   it off would save the shop's settings every time somebody asked what a
 *   field meant.
 *
 * **The panel is rendered into `document.body`, not beside its trigger.** A
 * `position: fixed` box is only laid out in viewport coordinates while no
 * ancestor has made itself a containing block — and in Chromium every
 * `<details>` does, through the `::details-content` pseudo-element the UA wraps
 * its body in. That pseudo is invisible to an ancestor walk (it is not an
 * `Element`), which is why this looked impossible before it was measured: the
 * panel's computed `left`/`top` were exactly right and its rendered box was
 * 89px right and 552px down from them, on a page where every hint sits inside
 * a disclosure row. Settings' eleven hints, the public schedule's deal list,
 * the readiness page's gear form — all of them are inside a `<details>`, which
 * is the whole of the reported "the tooltip is weirdly far from the icon".
 * A portal to `document.body` puts the panel where its coordinates mean what
 * they say, whatever the trigger is nested in.
 *
 * **And it is placed by measurement, not hung off the trigger.**
 * It used to be `absolute top-7 left-0 w-72`, which means an 18rem panel
 * growing rightwards from a 20px marker: on a 390px phone every trigger that
 * is not at the far left put its panel past the right edge, and an absolutely
 * positioned box that overflows still counts toward the document's scroll
 * width *while it is invisible*. Settings' eleven hints between them left the
 * whole page draggable 165px sideways with nothing out there to see — which is
 * the reported bug, and it was never a clipped tooltip. A viewport-clamped
 * `fixed` panel cannot do that at any width (fixed boxes never extend the
 * scrollable area), so this is the one shape that is correct on a phone and on
 * a 1440px desktop without a breakpoint guessing which is which.
 *
 * The measuring is what costs hover its pure-CSS implementation. That trade is
 * worth naming: `:hover` cannot tell the panel where the viewport edge is, and
 * a page full of these listeners is a page full of `getBoundingClientRect` on
 * pointer-enter — cheap, and only on the hint actually being pointed at.
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
  // The portal needs a document, so the first render — the server's, and the
  // client's hydration pass — keeps the panel inline. It carries no position
  // and is invisible either way; what it does carry is the id
  // `aria-describedby` points at, so the description resolves in the static
  // HTML rather than appearing only once React has mounted.
  const [portalled, setPortalled] = useState(false);
  useEffect(() => setPortalled(true), []);
  // Null until the panel has been placed — it renders off-flow and invisible
  // until then, so a first paint never flashes it at the top-left corner.
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    // **The mark, not the target.** The button's box is the glyph's own 20px
    // box; its 44px target is a stretched `::after`, which a bounding rect does
    // not include. So measuring the button is measuring the mark, and the
    // panel hangs off what the eye is on. (When the button *was* the 44px box,
    // measuring it put the panel 16px below and left of the mark.)
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    // Left-aligned to the trigger where there is room, pulled back so the
    // panel's right edge clears the viewport where there isn't, and never past
    // the left margin — which is the whole job the old `left-0` could not do.
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN),
    );
    // Below the marker, or above it when the marker is near the bottom of the
    // screen — a hint on the last card of a long settings page is exactly where
    // "below" runs out of room.
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
      // `z-50`, the tier every other floating surface in the app uses (Toast,
      // Modal, CommandPalette). It was `z-30` while the panel lived inside the
      // page's own stacking context; on `document.body` it shares the root one
      // with the sticky headers, which are `z-40` — and the panel flips
      // *above* its trigger whenever it would not fit below, which is exactly
      // where it would have gone behind a header.
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
        // No border. The glyph below is already a filled disc, so a ring around
        // it read as a circle drawn around a circle — and beside a heading it
        // looked like a control that had lost its label rather than a marker.
        // Colour alone carries the affordance now; `focus-visible` keeps the
        // keyboard ring, which is the one border that was ever doing work.
        // **The glyph is 20px; the target is 44.** `size-5` was the whole
        // control, so the one "why are you asking me this?" affordance on the
        // public booking form was a 20px dot for a thumb (issue #786,
        // principles.md §2). The mark stays 20px, and the target reaches the
        // floor through a stretched `::after` (`-inset-3`: 20 + 2 × 12 = 44),
        // which costs the line no height and moves nothing beside it.
        //
        // **The button is the mark's box, not the target's** (pixel-craft
        // class 7). It was the 44px box itself, pulled back with `-m-3`, and
        // the global focus ring drew 5px outside that: a 54px circle round
        // the mark that ran into the "$15.00" beside it on the readiness
        // page's gear list. Ringing the mark instead would need the button's
        // own outline off, which `focus-ring.test.ts` refuses; moving the
        // target off the box puts the same global ring 5px round the 20px
        // mark. The glyph was drawn at 12px inside this box until then, where
        // its knockout "i" was under 2px across and read as a grey dot
        // (class 2); it now fills it.
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
