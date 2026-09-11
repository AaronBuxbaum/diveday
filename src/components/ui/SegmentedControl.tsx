"use client";

import Link from "next/link";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

/**
 * The one segmented control: a sunken track with a raised pill on the current
 * choice, for a small set of sibling destinations that are real URLs.
 *
 * Four surfaces used to hand-roll this grammar — the trip tab bar, the waiver
 * tabs, the manifest's checkpoint row, and the Today queue's view switch — and
 * they had already drifted (a fourth `rounded-full` variant, three subtly
 * different class strings). Like `buttonClass()` and `Pager`, the cure is one
 * component: if a segmented control looks wrong, fix it here, never at a call
 * site.
 *
 * The mechanics it guarantees, so no caller has to remember them:
 *
 * - **Links, not client state.** Every option is a real `<Link>` to a real
 *   URL, so it opens in a new tab, bookmarks, and works before JavaScript.
 *   The wrapper is a `<nav>` named by `ariaLabel`.
 * - **Dock-test targets.** `min-h-11` (44px) by default; `size="boat"` raises
 *   the floor to `min-h-14` with 16px labels for surfaces worked at the rail
 *   with wet hands (the manifest's checkpoint row). Labels are centered in
 *   the target structurally (`inline-flex items-center justify-center`).
 * - **No layout shift on selection.** Both states share one font size and one
 *   weight (`font-semibold`); selection is carried by the raised pill —
 *   fill, ink, and shadow plus `aria-current` — never by a weight change that
 *   would reflow the row, and never by color alone.
 * - **The pill slides.** The raised pill is one element that moves from the
 *   choice it was on to the choice it is on now — a FLIP on `transform`, 200ms
 *   on the arrival curve, nothing laid out twice — so a tap explains where the
 *   selection went instead of the highlight blinking off one option and on
 *   another. Every option is a navigation, so the slide happens across the
 *   re-render: the component keeps the last measured box in a ref and, when
 *   `currentKey` changes, starts the pill from there. Before JavaScript, and
 *   for the first paint, the current option still draws its own fill, so the
 *   control never depends on the effect to look selected; the pill takes over
 *   once it has measured. `prefers-reduced-motion` stills it through the
 *   global kill-switch.
 * - **Overflow wraps, never scrolls.** Labels stay `whitespace-nowrap`, and a
 *   row too wide for its container stacks onto a second line with each row's
 *   options sharing the width, rather than sliding sideways.
 *
 *   It scrolled until 2026-08-22, and that was measured wrong rather than
 *   decided wrong. At 390px the departure's four tabs came to `scrollWidth 343`
 *   in a `clientWidth 340` — three pixels, which turns a strip that visually
 *   fits into one that clips "Prep" by a hair, drags sideways and springs back,
 *   and jiggles under a thumb that meant to scroll the page. On the surface a
 *   crew member uses to get from the roster to the roll call, on a boat
 *   (issue #811).
 *
 *   **In Spanish the same strip is 436 against 340.** Ninety-six pixels, so no
 *   amount of gap or padding closes it and a scroller was always going to hide
 *   a whole tab from every Spanish-speaking shop. The checkpoint row below is
 *   `size="boat"` with longer labels still. A wrapped row asks for no gesture
 *   and hides nothing, which is what the dock test wants; `e2e/` asserts no
 *   control scrolls at 390px in either locale, because a rendered-pixel diff
 *   cannot tell a clipped strip from a scrollable one.
 * - **A caller may supply a shorter word for below `sm`** (`shortLabel`), for a
 *   track whose full labels wrap a phone even after that. Only where the full
 *   name is already on screen at that width: the short form is a handle, not a
 *   rename. Both forms are in the DOM and `hidden` picks one, so whichever is
 *   shown is also the accessible name — no `aria-hidden` juggling and nothing
 *   read twice.
 * - **Never on paper.** A way to switch surfaces means nothing printed, so
 *   the track is `print:hidden` unconditionally.
 *
 * The current item renders **inert** (a `<span>` with `aria-current`) by
 * default — a tab bar's "you are here" is not a destination. A control whose
 * options are views of the *same* page (`?view=`, `?checkpoint=`) passes
 * `currentIsLink` so the current choice stays a harmless, clickable link, and
 * usually `scroll={false}` so switching views holds the reader's place.
 *
 * Labels arrive resolved: staff copy is server-side only, so each call site
 * translates its own options and passes words. A Client Component, for the
 * pill's measurement only; a Server Component call site may import it freely
 * (its props are serialisable) and so may a Client Component.
 */
export type SegmentedControlItem = {
  /** Stable identity, compared against `currentKey`. */
  key: string;
  /** Resolved copy — words come from a message bundle at the call site. */
  label: ReactNode;
  /**
   * A shorter form of `label`, rendered instead of it below `sm` — for a track
   * that still wraps a 390px phone at full length. Supply it only where the
   * full name is visible on the same screen at that width; the short word is a
   * handle for a choice that is spelled out elsewhere, never the only place
   * the choice is named.
   */
  shortLabel?: ReactNode;
  href: string;
};

const sizes = {
  /**
   * The default 44px dock-test target.
   *
   * `px-2.5` rather than `px-3`, which is worth the half-step: the departure's
   * four tabs came to 343px in a 340px container at the narrowest viewport we
   * design for, and 2px off each side of each tab is 16px — enough that English
   * stays on one row instead of wrapping for the sake of three pixels. The
   * target's height is untouched, and its width is set by the label anyway
   * (issue #811).
   */
  md: "min-h-11 px-2.5 text-sm",
  /** Boat surfaces: 56px targets, 16px labels, for wet hands and glare. */
  boat: "min-h-14 px-5 text-base",
} as const;

export type SegmentedControlSize = keyof typeof sizes;

/** The raised pill's own look — the one place the selected fill is spelled. */
const PILL_CLASS = "bg-surface shadow-sm";

export function SegmentedControl({
  ariaLabel,
  items,
  currentKey,
  size = "md",
  fill = false,
  currentIsLink = false,
  ariaCurrentValue = "page",
  scroll,
  className = "",
}: {
  ariaLabel: string;
  items: readonly SegmentedControlItem[];
  /** The current item's key, or null when no option is current (nothing is marked). */
  currentKey: string | null;
  size?: SegmentedControlSize;
  /** Equal-width options spanning the container, vs. a content-width track. */
  fill?: boolean;
  /**
   * Keep the current choice a clickable link instead of an inert span — for
   * controls whose options are views of the same page rather than routes.
   */
  currentIsLink?: boolean;
  /** `"page"` for tabs between routes; `"true"` for a view choice within one. */
  ariaCurrentValue?: "page" | "true";
  /** Passed to `<Link>`; `false` holds scroll position across a view switch. */
  scroll?: boolean;
  className?: string;
}) {
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  // The box the pill last sat on, in the track's own coordinates — the "first"
  // of the FLIP, kept across renders so a navigation can be animated from it.
  const lastBox = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  // Until the pill has measured once, the current option draws its own fill.
  const [pillReady, setPillReady] = useState(false);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const pill = pillRef.current;
    if (!nav || !pill) return;

    const place = (animate: boolean) => {
      let current: HTMLElement | null = null;
      for (const option of nav.querySelectorAll<HTMLElement>("[data-key]")) {
        if (option.dataset.key === currentKey) current = option;
      }
      if (!current) {
        pill.style.opacity = "0";
        lastBox.current = null;
        return;
      }
      const navBox = nav.getBoundingClientRect();
      const box = current.getBoundingClientRect();
      // **Snapped to the device pixel grid, and that is load-bearing.**
      // `getBoundingClientRect` answers in fractions, and the fraction is not
      // stable: measured three times on one commit under the e2e harness, the
      // same option reported heights of 44.0608, 44.046 and 44.0319 and tops of
      // 4.9696, 4.97702 and 4.98404 — text metrics still settling as the run
      // warmed. Written straight through as inline styles, a box that lands a
      // hundredth of a pixel differently antialiases its top and bottom edges
      // differently, and reg-suit reported `prep-by-diver` as changed on
      // branches that render nothing on that page: 898 pixels at a maximum
      // channel delta of 47, on the pill's horizontal edges across its full
      // width and nowhere else (issue 1578).
      //
      // The pill is a decorative fill *behind* an option whose own box is what
      // a reader sees and what the pointer hits, so moving it by at most half a
      // device pixel costs nothing visible and removes the whole class — every
      // `SegmentedControl` in the suite, not just the one that was caught.
      // Device pixels rather than CSS pixels because the grid antialiasing
      // happens on is physical: at dpr 2 a half-pixel edge is exact, and
      // rounding it away would be the only visible thing this does.
      const dpr = window.devicePixelRatio || 1;
      const snap = (value: number) => Math.round(value * dpr) / dpr;
      const next = {
        left: snap(box.left - navBox.left),
        top: snap(box.top - navBox.top),
        width: snap(box.width),
        height: snap(box.height),
      };
      pill.style.opacity = "1";
      pill.style.left = `${next.left}px`;
      pill.style.top = `${next.top}px`;
      pill.style.width = `${next.width}px`;
      pill.style.height = `${next.height}px`;
      const prev = lastBox.current;
      lastBox.current = next;
      if (!animate || !prev || next.width === 0 || next.height === 0) return;
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      const sx = prev.width / next.width;
      const sy = prev.height / next.height;
      if (dx === 0 && dy === 0 && sx === 1 && sy === 1) return;
      // Invert: start the pill where it was, then let the transition carry it
      // to where it is. The reflow between the two writes is what separates
      // "set" from "transition to" for the browser.
      pill.style.transition = "none";
      pill.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      void pill.offsetWidth;
      pill.style.transition = "";
      pill.style.transform = "";
    };

    place(true);
    setPillReady(true);
    if (typeof ResizeObserver === "undefined") return;
    // A wrap or a font swap moves the options; the pill follows without motion.
    const observer = new ResizeObserver(() => place(false));
    observer.observe(nav);
    return () => observer.disconnect();
  }, [currentKey]);

  // Block-level `flex` in both shapes, never `inline-flex`: an inline-level
  // box opts out of margin collapsing, so a track with `mt-*` below a header
  // with `mb-*` would stack the two margins instead of taking the larger —
  // +28px of phantom space the old hand-rolled navs (all block-level) never
  // had. Content width comes from `w-fit`, not from being inline.
  const track = `relative flex ${
    fill ? "" : "w-fit max-w-full"
  } flex-wrap gap-1 rounded-inset border border-border bg-surface-sunken p-1 print:hidden ${className}`.trim();
  return (
    <nav ref={navRef} aria-label={ariaLabel} className={track}>
      {/* First in the tree so every option paints above it; `relative` on the
          options is what puts them in the same paint order. Positioned by the
          effect above, invisible until it has measured. */}
      <span
        ref={pillRef}
        aria-hidden="true"
        className={`pointer-events-none absolute rounded-lg transition-transform ease-out-soft [transform-origin:top_left] ${PILL_CLASS}`}
        style={{ opacity: 0 }}
      />
      {items.map((item) => {
        const active = item.key === currentKey;
        // `grow` on the content-width variant too: it does nothing while the
        // row fits (a `w-fit` track is exactly its content), and once the row
        // wraps it is what makes each line share its width instead of sitting
        // ragged — four tabs become a 2x2 block on a phone.
        const cls = `relative inline-flex ${
          fill ? "flex-1" : "grow"
        } pressable items-center justify-center rounded-lg font-semibold whitespace-nowrap ${sizes[size]} ${
          active
            ? `text-primary${pillReady ? "" : ` ${PILL_CLASS}`}`
            : "text-muted hover:bg-surface hover:text-foreground"
        }`;
        // `hidden` is `display: none`, so exactly one form is in the
        // accessibility tree at any width and the accessible name is whichever
        // one a reader can see. An item with no `shortLabel` renders its label
        // bare, so no existing call site gains a wrapper element.
        const content =
          item.shortLabel === undefined ? (
            item.label
          ) : (
            <>
              <span className="sm:hidden">{item.shortLabel}</span>
              <span className="max-sm:hidden">{item.label}</span>
            </>
          );
        if (active && !currentIsLink) {
          return (
            <span
              key={item.key}
              data-key={item.key}
              aria-current={ariaCurrentValue}
              className={cls}
            >
              {content}
            </span>
          );
        }
        return (
          <Link
            key={item.key}
            href={item.href}
            data-key={item.key}
            scroll={scroll}
            aria-current={active ? ariaCurrentValue : undefined}
            className={cls}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
