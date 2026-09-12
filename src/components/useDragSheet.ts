"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
 * **no fight with a scroll** — once the sheet's own list can scroll at all the
 * handle is the only drag surface, and below that it is any part of a sheet
 * that is not scrolled, so a finger that means to read the list always reads
 * the list (amended for #1512; ADR decision 4 carries the measurement).
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
  /**
   * Spread onto the sheet's own element. Only the press is bound here — the
   * rest of the gesture is tracked on the document, so a finger that wanders
   * off the sheet is still the finger holding it.
   */
  handlers: { onPointerDown: (event: React.PointerEvent<HTMLElement>) => void };
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
  /** Removes this gesture's document listeners. Null when no press is live. */
  const release = useRef<(() => void) | null>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  const end = useCallback(() => {
    release.current?.();
    release.current = null;
    start.current = null;
    recent.current = null;
    moved.current = false;
    setDragging(false);
    setOffset(0);
  }, []);

  // A press that never became a gesture still leaves listeners on the document
  // if the sheet unmounts under the finger — which is exactly what happens when
  // a tap on a row navigates away.
  useEffect(() => () => release.current?.(), []);

  /**
   * **The gesture is tracked on the document, and the pointer is never
   * captured.** Two failures, one answer:
   *
   * - `setPointerCapture` on the press retargets every later pointer event to
   *   the sheet, so a tap that never moves produces no `click` on the row
   *   underneath: every destination in the More sheet silently stopped
   *   navigating (caught by `staff-nav.spec.ts`, fixed in #1423).
   * - Capturing only once the drag begins fixes that and opens a second hole:
   *   below the slop nothing is captured, so a finger that starts near the
   *   sheet's bottom edge and crosses the slop over the dock is moving over an
   *   element the sheet's own handlers never hear from, and the drag never
   *   starts.
   *
   * Listening on the document for the life of the press answers both. It sees
   * every move wherever the finger goes, which is what capture was for, and it
   * retargets nothing, which is what the click needs. The listeners are scoped
   * to this pointer id and removed on release, on cancel, and on unmount.
   */
  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (disabled || release.current !== null) return;
    // Touch and pen report `button === -1`; only a non-primary *mouse* button
    // is not a press. The same line, for the same reason, as the pull.
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const sheet = event.currentTarget;
    // **The scroll wins, and it wins before it starts** (#1512). A sheet whose
    // own list can scroll is a sheet the finger is reading, so a downward drag
    // anywhere in it belongs to the list — not only once it has been scrolled.
    // Until #1512 a press on a row of a full sheet passed this gate (nothing
    // was scrolled yet), started a gesture, got exactly one `pointermove` and
    // then died when the browser claimed the scroll: the sheet sat open under
    // a thumb that meant to close it, and nothing said why. Refusing the press
    // up front means no half-started gesture and no `preventDefault` racing the
    // scroller. Dragging from the handle works at any size and any scroll
    // position, because a handle is not content.
    const onHandle = (event.target as HTMLElement | null)?.closest("[data-sheet-handle]") !== null;
    if (!onHandle && listOwnsDrag(sheet)) return;

    const pointerId = event.pointerId;
    start.current = { y: event.clientY, height: sheet.getBoundingClientRect().height };
    recent.current = { y: event.clientY, at: event.timeStamp };

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const from = start.current;
      if (from === null) return;
      const delta = moveEvent.clientY - from.y;
      if (!moved.current && Math.abs(delta) < SLOP_PX) return;
      moved.current = true;
      // Once this is a drag, the finger owns the gesture: without this the
      // browser scrolls the page (or the sheet's own list) under a hand that
      // means to move the sheet. Registered `passive: false` for exactly this.
      if (moveEvent.cancelable) moveEvent.preventDefault();
      setDragging(true);
      // Down is one for one; up resists, so the sheet reads as attached at the
      // top rather than as a thing that can be thrown off the screen upward.
      setOffset(delta >= 0 ? delta : delta * RESISTANCE);
      if (recent.current === null || moveEvent.timeStamp - recent.current.at > VELOCITY_WINDOW_MS) {
        recent.current = { y: moveEvent.clientY, at: moveEvent.timeStamp };
      }
    };

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      const from = start.current;
      if (from === null || !moved.current) {
        end();
        return;
      }
      const travelled = upEvent.clientY - from.y;
      const since = recent.current;
      const elapsed = since === null ? 0 : upEvent.timeStamp - since.at;
      const velocity =
        since === null || elapsed < MIN_VELOCITY_MS ? 0 : (upEvent.clientY - since.y) / elapsed;
      const leaving = dismissOnRelease({ travelled, height: from.height, velocity });
      // Either way the gesture is over and the offset goes back to zero: on a
      // dismissal the caller's own exit animation takes the sheet the rest of
      // the way, and holding the offset would fight it.
      end();
      if (leaving) dismiss.current();
    };

    const onCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === pointerId) end();
    };

    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    release.current = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
    };
  };

  return {
    offset,
    dragging,
    handlers: { onPointerDown },
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

/**
 * **Is this press the list's rather than the sheet's?** One walk over the sheet
 * and everything in it, answering both halves in a single pass: has a list here
 * been scrolled away from its top, and — since #1512 — can one scroll at all.
 */
function listOwnsDrag(sheet: HTMLElement): boolean {
  if (scrollsVertically(sheet)) return true;
  for (const node of sheet.querySelectorAll("*")) {
    if (node instanceof HTMLElement && scrollsVertically(node)) return true;
  }
  return false;
}

/**
 * Content taller than the box is not enough on its own: an `sr-only` heading is
 * a 1px box clipping twenty pixels of text, and every sheet has one, so the
 * bare measurement would say every sheet overflows and no press anywhere would
 * ever start a drag. Only a box the browser will actually scroll counts.
 */
function scrollsVertically(node: HTMLElement): boolean {
  if (node.scrollTop > 0) return true;
  if (node.scrollHeight <= node.clientHeight) return false;
  const overflowY = getComputedStyle(node).overflowY;
  return overflowY === "auto" || overflowY === "scroll";
}
