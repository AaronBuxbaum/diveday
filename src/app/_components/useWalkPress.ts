"use client";

import { type PointerEvent, type RefObject, useEffect, useRef } from "react";
import type { WalkBeat } from "./HomeWalkthrough";
import { useWalkSwipe } from "./useWalkSwipe";

/** Fewer than this many pixels sideways is a tap, not a swipe. */
const SWIPE_PX = 40;

/** A press must move this far, in any direction, before it is read as a drag or a scroll. */
const SLOP_PX = 8;

/** A drag is a swipe only when it goes this many times further sideways than up or down. */
const SIDEWAYS_RATIO = 2;

/** A press held this long is a hold (it pauses, and its release is not a tap). */
const HOLD_MS = 250;

/**
 * The walkthrough's hands: a press, a drag, a swipe or a tap, from a finger (touch events) or a
 * mouse (pointer events). `onHeld` says whether a press is down, which pauses the walk.
 */
export function useWalkPress({
  rootRef,
  sliding,
  index,
  total,
  beats,
  go,
  onHeld,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  sliding: RefObject<boolean>;
  index: number;
  total: number;
  beats: readonly WalkBeat[];
  go: (to: number) => void;
  onHeld: (held: boolean) => void;
}) {
  const swipeFrom = useRef<number | null>(null);
  const swipeFromY = useRef(0);
  const dragging = useRef(false);
  /** Set once a press has moved up or down: it is the page scrolling, and never a swipe or a tap. */
  const scrolling = useRef(false);
  const pressedAt = useRef(0);
  const setHeld = onHeld;

  const { dragBy, springBack, slide } = useWalkSwipe({
    rootRef,
    sliding,
    index,
    total,
    beats,
    go,
  });

  const press = (x: number, y: number) => {
    if (sliding.current) return;
    swipeFrom.current = x;
    swipeFromY.current = y;
    dragging.current = false;
    scrolling.current = false;
    pressedAt.current = performance.now();
    setHeld(true);
  };

  /** Moves the drag on; true once the press has become a sideways drag. */
  const moveTo = (x: number, y: number): boolean => {
    const from = swipeFrom.current;
    if (from === null) return false;
    if (scrolling.current) return false;
    const dx = x - from;
    if (!dragging.current) {
      const ax = Math.abs(dx);
      const ay = Math.abs(y - swipeFromY.current);
      if (Math.max(ax, ay) < SLOP_PX) return false;
      if (ax < ay * SIDEWAYS_RATIO) {
        // Decided once: a press that began as a scroll stays one, however far it drifts sideways.
        scrolling.current = true;
        setHeld(false);
        return false;
      }
      dragging.current = true;
    }
    dragBy(dx);
    return true;
  };

  const lift = (x: number, target: EventTarget | null) => {
    const from = swipeFrom.current;
    swipeFrom.current = null;
    const wasDragging = dragging.current;
    const wasScrolling = scrolling.current;
    dragging.current = false;
    scrolling.current = false;
    setHeld(false);
    if (from === null || wasScrolling) return;
    const moved = x - from;
    if (wasDragging && Math.abs(moved) >= SWIPE_PX) {
      slide(moved < 0 ? 1 : -1, moved);
    } else if (wasDragging) {
      springBack(moved);
    } else if (
      Math.abs(moved) < SLOP_PX &&
      performance.now() - pressedAt.current < HOLD_MS &&
      target instanceof HTMLElement &&
      target.closest("[data-walk-frame]") &&
      !target.closest("a, button")
    ) {
      // Instagram's stories: the left edge of a screen goes back, the rest on.
      const rect = target.closest("[data-walk-frame]")?.getBoundingClientRect();
      const back = rect && rect.width > 0 && x < rect.left + rect.width * 0.3;
      go(index + (back ? -1 : 1));
    }
  };

  const release = () => {
    const wasDragging = dragging.current;
    swipeFrom.current = null;
    dragging.current = false;
    scrolling.current = false;
    setHeld(false);
    if (wasDragging) springBack(0);
  };

  // A finger is read from touch events, not pointer events: the browser takes a touch for a
  // scroll as soon as it leans up or down and cancels its pointer, so a swipe with the slightest
  // lean never arrived. A touch move is ours to claim while it is still undecided, and a sideways
  // one is claimed once it is clearly more sideways than up or down.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onStart = (event: TouchEvent) => {
      const t = event.touches[0];
      if (event.touches.length > 1 || !t) return release();
      press(t.clientX, t.clientY);
    };
    const onMove = (event: TouchEvent) => {
      const t = event.touches[0];
      if (!t || event.touches.length > 1) return release();
      if (moveTo(t.clientX, t.clientY)) event.preventDefault();
    };
    const onEnd = (event: TouchEvent) => {
      const t = event.changedTouches[0];
      if (t) lift(t.clientX, event.target);
      else release();
    };
    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd);
    root.addEventListener("touchcancel", release);
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", release);
    };
  });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    press(event.clientX, event.clientY);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const wasDragging = dragging.current;
    if (moveTo(event.clientX, event.clientY) && !wasDragging) {
      // From here the drag is the walk's, wherever the pointer goes.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    lift(event.clientX, event.target);
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") release();
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerEnd };
}
