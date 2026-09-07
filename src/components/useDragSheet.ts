"use client";

import { useCallback, useRef, useState } from "react";
import { motionMs } from "@/lib/motion";

/**
 * **A sheet a thumb opened from the dock closes with the same thumb** — ADR
 * 20260907-nothing-from-nowhere, decision 4.
 *
 * The dock's "More" sheet rose over 200ms and could not be touched: it
 * dismissed on a tap anywhere on the scrim, which on a phone is the top of the
 * screen — reached by stretching the thumb that opened it from the bottom
 * inch. Principle 2's dock test forbids exactly that reach, and the app already
 * had the physics to avoid it: `PullToRefresh` and `BuddyDragGroups` share one
 * written gesture contract, and this is the third hand under it.
 *
 * The contract, unchanged from theirs: **pointer events only** (no gesture
 * library, one code path for touch and pen and mouse), **resistance past the
 * edge** rather than a hard stop, **a cancel curve when released short**, and
 * **no fight with a scroll** — a drag begins only where the sheet is not
 * scrolled, so a finger that means to read the list always reads the list.
 *
 * **The finger outranks the timer.** While a drag is live nothing here
 * animates: `offset` is whatever the finger has travelled, applied directly,
 * one pixel per pixel, and the scrim's opacity is that same number. A reader
 * who asked for reduced motion still gets this, because a thing moving under
 * their own finger is not animation — it is the sheet being where they put it.
 *
 * Releasing is the only decision: **past the line, or thrown**, and the sheet
 * leaves from where it is; short of the line, it settles back. Velocity is
 * measured over the last moment of the gesture rather than the whole of it, so
 * a slow drag that ends in a flick reads as a flick, which is what the hand
 * meant.
 */

/** How far down the sheet must be, as a share of its height, to leave on release. */
const DISMISS_AT = 0.4;
/** Pixels per millisecond past which a release is a throw, whatever the distance. */
const THROW_VELOCITY = 0.5;
/**
 * A release closer than this to the last movement has no measurable speed, and
 * is read as a distance instead of as a throw.
 *
 * Without it, a gentle drag whose last move and release land in the same
 * millisecond divides by ~0 and reads as a flick — the sheet leaves from under
 * a hand that was putting it back. The guard is what makes "thrown" a claim
 * about a hand rather than about event scheduling.
 */
const MIN_VELOCITY_MS = 8;
/** Travel before a drag is a drag: below this a finger is still deciding. */
const SLOP_PX = 6;
/** How much of an upward pull the sheet gives: the pull-to-refresh's own damping. */
const RESISTANCE = 0.4;
/** The window a throw is measured over. Longer, and a flick averages away. */
const VELOCITY_WINDOW_MS = 100;

/**
 * **Does this release mean to close the sheet?** Pure, and separated from the
 * hand that produced the numbers, because it is the whole of the gesture's
 * judgement and the one part worth stating exhaustively in a test.
 *
 * Two ways to mean it: take it far enough that letting go anywhere else would
 * be surprising, or throw it, which means it whatever distance it covered. An
 * upward release is neither, whatever its speed.
 */
export function dismissOnRelease({
  travelled,
  height,
  velocity,
}: {
  /** How far below its resting place the sheet was when the finger let go. */
  travelled: number;
  /** The sheet's own height, which is what "far enough" is a share of. */
  height: number;
  /** Pixels per millisecond, downward positive, or 0 when it cannot be measured. */
  velocity: number;
}): boolean {
  if (travelled <= 0) return false;
  return velocity > THROW_VELOCITY || travelled > height * DISMISS_AT;
}

export type DragSheet = {
  /** How far below its resting place the sheet currently sits, in pixels. */
  offset: number;
  /** True while a finger is on it: the caller must not animate anything. */
  dragging: boolean;
  /** Spread onto the sheet's own element. */
  handlers: {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: () => void;
  };
  /** The style the sheet wears: the finger's travel, or the release settling. */
  style: React.CSSProperties;
  /** 1 at rest, 0 when the sheet is fully dragged away — the scrim's own opacity. */
  scrim: number;
};

export function useDragSheet({
  onDismiss,
  disabled = false,
}: {
  /** Called once, when the release says the sheet is leaving. */
  onDismiss: () => void;
  /** True while the sheet is closing on its own, so a stray pointer cannot re-open the gesture. */
  disabled?: boolean;
}): DragSheet {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ y: number; height: number } | null>(null);
  const recent = useRef<{ y: number; at: number } | null>(null);
  const moved = useRef(false);
  /** The pointer this gesture captured, so the release can hand it back. */
  const captured = useRef<number | null>(null);
  const sheetNode = useRef<HTMLElement | null>(null);

  const end = useCallback(() => {
    if (captured.current !== null) {
      sheetNode.current?.releasePointerCapture?.(captured.current);
      captured.current = null;
    }
    start.current = null;
    recent.current = null;
    moved.current = false;
    setDragging(false);
    setOffset(0);
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (disabled) return;
    // Touch and pen report `button === -1`; only a non-primary *mouse* button
    // is not a press. The same line, for the same reason, as the pull.
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const sheet = event.currentTarget;
    // **The scroll wins.** A sheet whose own list has been scrolled is a sheet
    // the finger is reading, so a downward drag there belongs to the list.
    // Dragging from the handle works at any scroll position, because a handle
    // is not content.
    const onHandle = (event.target as HTMLElement | null)?.closest("[data-sheet-handle]") !== null;
    const scrolled = findScrolled(sheet);
    if (!onHandle && scrolled > 0) return;
    sheetNode.current = sheet;
    start.current = { y: event.clientY, height: sheet.getBoundingClientRect().height };
    recent.current = { y: event.clientY, at: event.timeStamp };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const from = start.current;
    if (from === null) return;
    const delta = event.clientY - from.y;
    if (!moved.current && Math.abs(delta) < SLOP_PX) return;
    if (!moved.current) {
      // **Capture only once this is a drag, never on the press.** Capturing on
      // `pointerdown` retargets every later pointer event to the sheet, and a
      // tap that never moves then produces no `click` on the row underneath —
      // so every destination in the sheet silently stopped navigating, which
      // is what `staff-nav.spec.ts` caught. Below the slop there is no
      // gesture (the contract's own words), so there is nothing to capture.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      captured.current = event.pointerId;
    }
    moved.current = true;
    setDragging(true);
    // Down is one for one; up resists, so the sheet reads as attached at the
    // top rather than as a thing that can be thrown off the screen upward.
    setOffset(delta >= 0 ? delta : delta * RESISTANCE);
    if (recent.current === null || event.timeStamp - recent.current.at > VELOCITY_WINDOW_MS) {
      recent.current = { y: event.clientY, at: event.timeStamp };
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const from = start.current;
    if (from === null || !moved.current) {
      end();
      return;
    }
    const travelled = event.clientY - from.y;
    const since = recent.current;
    const elapsed = since === null ? 0 : event.timeStamp - since.at;
    const velocity =
      since === null || elapsed < MIN_VELOCITY_MS ? 0 : (event.clientY - since.y) / elapsed;
    if (dismissOnRelease({ travelled, height: from.height, velocity })) {
      // Leave from where the finger let go: the caller's own exit animation
      // takes it the rest of the way, and holding the offset would fight it.
      end();
      onDismiss();
      return;
    }
    if (captured.current !== null) {
      sheetNode.current?.releasePointerCapture?.(captured.current);
      captured.current = null;
    }
    setDragging(false);
    moved.current = false;
    start.current = null;
    recent.current = null;
    setOffset(0);
  };

  return {
    offset,
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: end },
    style: {
      transform: offset === 0 ? undefined : `translateY(${offset}px)`,
      // No transition while a finger is on it — the finger is the clock. On
      // release the settle-back runs on the spring, which is the one claim
      // `--ease-spring` is rationed for: the sheet has weight because a hand
      // just gave it some (H-69 a).
      transition: dragging
        ? "none"
        : `transform ${motionMs("base")}ms var(--ease-spring, var(--ease-out-soft))`,
    },
    scrim: start.current === null ? 1 : Math.max(0, 1 - offset / Math.max(1, start.current.height)),
  };
}

/** How far the nearest scrollable ancestor inside the sheet has been scrolled. */
function findScrolled(sheet: HTMLElement): number {
  for (const node of sheet.querySelectorAll("*")) {
    if (node instanceof HTMLElement && node.scrollTop > 0) return node.scrollTop;
  }
  return sheet.scrollTop;
}
