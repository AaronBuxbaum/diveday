"use client";

import Link from "next/link";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import {
  SEGMENT_CORNER,
  SEGMENT_RAISED,
  segmentClass,
  segmentedGridTrackClass,
} from "@/components/ui/segmented";

/**
 * Shared navigation for a small set of sibling destinations, drawn as a
 * sunken track with one animated raised pill. See
 * `docs/design/forms-and-controls.md#segmented-choices-segmentedcontrol` for
 * the design rationale and measured wrapping history.
 *
 * Options are real links in a named `<nav>`; the current item is inert unless
 * `currentIsLink` is set. Targets are 44px (`md`) or 56px (`boat`), wrapping
 * uses equal columns without horizontal scrolling, and selection remains
 * visible before hydration. The pill respects reduced motion, labels retain
 * their accessible name when `shortLabel` is shown, and the control is hidden
 * in print. Keep layout and corner styles centralized in `segmented.ts`.
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
  /** Default 44px target; width floor also protects short labels such as SDI and SSI (issue #811). */
  md: "min-h-11 min-w-11 px-2.5 text-sm",
  /** Boat surfaces: 56px targets on both axes, 16px labels, for wet hands and glare. */
  boat: "min-h-14 min-w-14 px-5 text-base",
} as const;

export type SegmentedControlSize = keyof typeof sizes;

/**
 * The columns a track needs, or `null` while its options fit on one line.
 *
 * **One line means equal widths**, so the question is whether every option at
 * the widest option's width fits: `count × widest`, plus the gaps, padding and
 * border. Reads the widest option laid at its own width (`flex: none`) and the
 * room its container gives the track. Both are set as inline styles and put
 * back before this returns, inside the same layout pass, so nothing is painted
 * in between.
 */
function columnsFor(nav: HTMLElement, count: number): number | null {
  const options = [...nav.querySelectorAll<HTMLElement>("[data-key]")];
  if (options.length < 2) return null;
  const style = nav.getAttribute("style");
  nav.style.display = "flex";
  nav.style.flexWrap = "nowrap";
  nav.style.maxWidth = "none";
  nav.style.width = "max-content";
  for (const option of options) option.style.flex = "none";
  const widest = Math.max(...options.map((option) => option.getBoundingClientRect().width));
  nav.style.width = "100%";
  const room = nav.getBoundingClientRect().width;
  for (const option of options) option.style.flex = "";
  if (style === null) nav.removeAttribute("style");
  else nav.setAttribute("style", style);
  const track = getComputedStyle(nav);
  const px = (value: string) => Number.parseFloat(value) || 0;
  const frame =
    px(track.paddingLeft) +
    px(track.paddingRight) +
    px(track.borderLeftWidth) +
    px(track.borderRightWidth);
  const gap = px(track.columnGap);
  const oneLine = options.length * widest + (options.length - 1) * gap + frame;
  // Half a pixel of slack: widths arrive in fractions, and a track that fits
  // exactly must not flip to a grid on a rounding error.
  if (oneLine <= room + 0.5) return null;
  const inner = room - frame;
  // As many columns as the widest option allows, never fewer than one...
  const fit = Math.max(1, Math.min(count, Math.floor((inner + gap) / (widest + gap))));
  // ...then balanced over the lines that takes: five in room for four are
  // 3 + 2, not 4 + 1.
  return Math.ceil(count / Math.ceil(count / fit));
}

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
  /** Options spanning the container, vs. a track as wide as its options need. Equal widths either way. */
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
  // `null` while the options fit on one line; otherwise the grid's columns.
  const [columns, setColumns] = useState<number | null>(null);
  // The pill's placement, kept so a change of layout can re-place it.
  const placePill = useRef<(animate: boolean) => void>(() => {});

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
      // Snap both option edges to the viewport device-pixel grid, then convert
      // to the track's padding-edge origin. Keep issue 1578 and #2525: snapping
      // in track coordinates or snapping size alone causes visible edge drift.
      const trackStyle = getComputedStyle(nav);
      const borderLeft = Number.parseFloat(trackStyle.borderLeftWidth) || 0;
      const borderTop = Number.parseFloat(trackStyle.borderTopWidth) || 0;
      //
      // Snap each edge in viewport coordinates (issue #2525), then express
      // the resulting box relative to the track's padding edge.
      const dpr = window.devicePixelRatio || 1;
      const snap = (value: number) => Math.round(value * dpr) / dpr;
      const originLeft = navBox.left + borderLeft;
      const originTop = navBox.top + borderTop;
      const edgeLeft = snap(box.left);
      const edgeTop = snap(box.top);
      const next = {
        left: edgeLeft - originLeft,
        top: edgeTop - originTop,
        width: snap(box.left + box.width) - edgeLeft,
        height: snap(box.top + box.height) - edgeTop,
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

    placePill.current = place;
    place(true);
    setPillReady(true);
    // Once the page's fonts have loaded the labels have their final widths,
    // whatever they measured at the first paint; the pill measures again then
    // (issue #2525). Without motion: nothing was chosen.
    let live = true;
    document.fonts?.ready.then(() => {
      if (live) place(false);
    });
    if (typeof ResizeObserver === "undefined") {
      return () => {
        live = false;
      };
    }
    // A wrap or a font swap moves the options; the pill follows without
    // motion. Each option is observed as well as the track, because an option
    // can change width while the track keeps its size, and then only the
    // option's own observer fires (issue #2525).
    const observer = new ResizeObserver(() => place(false));
    observer.observe(nav);
    for (const option of nav.querySelectorAll<HTMLElement>("[data-key]")) observer.observe(option);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [currentKey]);

  // One line or a grid, decided by measurement: on every render (the labels
  // may have changed) and whenever the track is resized. A layout effect, so
  // the first paint is already the right shape.
  const count = items.length;
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (nav) setColumns(columnsFor(nav, count));
  });
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setColumns(columnsFor(nav, count)));
    observer.observe(nav);
    return () => observer.disconnect();
  }, [count]);
  // A change of shape moves every option, and the track may keep its size
  // while it does, so the resize observer above cannot be relied on to tell
  // the pill. Without motion: the selection did not change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `columns` is a trigger, not a value the effect body reads.
  useLayoutEffect(() => {
    placePill.current(false);
  }, [columns]);

  // Block-level `grid` in both shapes, never `inline-grid`: an inline-level
  // box opts out of margin collapsing, so a track with `mt-*` below a header
  // with `mb-*` would stack the two margins instead of taking the larger —
  // +28px of phantom space the old hand-rolled navs (all block-level) never
  // had. Content width comes from `w-fit`, not from being inline. A wrapped
  // grid spans its room. The `display` is a class, never an inline style,
  // which outranks `print:hidden` and printed the track; only the column
  // count is inline.
  //
  // **Every option is the same width** (Aaron, 2026-10-03: a tab one label
  // longer than its neighbours made the row's targets jump). One line is a
  // grid of `1fr` columns: in a `w-fit` track that sizes every column to the
  // widest option, and in a `fill` track it splits the room evenly.
  //
  // Keep every track on its own compositor layer so the border paints
  // consistently across layouts (#2634).
  const track = `relative will-change-transform ${
    columns !== null
      ? segmentedGridTrackClass
      : `${segmentedGridTrackClass} grid-flow-col auto-cols-fr${fill ? "" : " w-fit max-w-full"}`
  } print:hidden ${className}`
    .replace(/\s+/g, " ")
    .trim();
  return (
    <nav
      ref={navRef}
      aria-label={ariaLabel}
      className={track}
      style={
        columns !== null ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined
      }
    >
      {/* First in the tree so every option paints above it; `relative` on the
          options is what puts them in the same paint order. Positioned by the
          effect above, invisible until it has measured, and cornered like the
          option it sits on. */}
      <span
        ref={pillRef}
        aria-hidden="true"
        className={`pointer-events-none absolute ${SEGMENT_CORNER} transition-transform ease-out-soft [transform-origin:top_left] ${SEGMENT_RAISED}`}
        style={{ opacity: 0 }}
      />
      {items.map((item) => {
        const active = item.key === currentKey;
        const cls = `relative inline-flex pressable items-center justify-center whitespace-nowrap ${sizes[size]} ${segmentClass(
          {
            selected: active,
            raised: !pillReady,
          },
        )}`;
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
