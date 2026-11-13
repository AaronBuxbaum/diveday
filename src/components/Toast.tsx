"use client";

import {
  type Key,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { motionMs } from "@/lib/motion";

// Matches the `.toast-dismiss` keyframe duration in globals.css. Kept as a
// timer (not `onAnimationEnd`) because the reduced-motion kill-switch there
// only shortens the animation to ~0ms — it doesn't skip it — and we want one
// unmount path that works identically either way.
const EXIT_DURATION_MS = motionMs("base");

/** How far a sideways drag must travel (px) before letting go sends the toast away. */
export const SWIPE_AWAY_DISTANCE_PX = 72;
/** A shorter flick still counts when it is quick: this far (px) inside this long (ms). */
const SWIPE_AWAY_FLICK_PX = 32;
const SWIPE_AWAY_FLICK_MS = 250;

/**
 * Whether a sideways drag of `dx` px that lasted `ms` sends a toast away: a
 * long drag, or a short quick flick. Sideways only; the caller has already
 * decided the drag was mostly horizontal.
 */
export function swipeSendsAway(dx: number, ms: number): boolean {
  const distance = Math.abs(dx);
  return (
    distance >= SWIPE_AWAY_DISTANCE_PX ||
    (distance >= SWIPE_AWAY_FLICK_PX && ms <= SWIPE_AWAY_FLICK_MS)
  );
}

/**
 * **The one toast**: pinned above the foot of the screen (and the phone's tab
 * bar), rising in and leaving through the shared exit animation. A null
 * `autoDismissMs` keeps an action-bearing toast available until dismissal or
 * navigation.
 *
 * `pausable`: on a timed toast, the countdown stops while a reader's mouse or
 * keyboard focus is anywhere in it, then resumes with the remaining time.
 */
export function ToastShell({
  autoDismissMs,
  pausable = false,
  placement = "fixed",
  role = "status",
  className,
  onSwipeAway,
  children,
}: {
  autoDismissMs: number | null;
  pausable?: boolean;
  /** Action toasts attached to page content must not cover the controls they explain. */
  placement?: "fixed" | "inline";
  /** `alert` for an error toast, so it is announced as it arrives. */
  role?: "status" | "alert";
  /** The box's own layout and inset; the frame, fill and shadow are shared. */
  className: string;
  /**
   * Swipe to dismiss (loop 5, row 15): a sideways drag past
   * {@link SWIPE_AWAY_DISTANCE_PX}, or a quick flick, calls this and nothing
   * else. It only ever puts the toast away; whatever the toast offers (an
   * Undo) is not touched, so the reversal's window is the same as after the
   * Dismiss button.
   */
  onSwipeAway?: () => void;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(true);
  const [dragX, setDragX] = useState(0);
  const dragRef = useRef<{ x: number; y: number; at: number; sideways: boolean } | null>(null);
  const justSwiped = useRef(false);
  const hovered = useRef(false);
  const focused = useRef(false);
  const [dismissing, setDismissing] = useState(false);

  // Pending auto-dismiss timer, or null while paused (hover/focus) or once
  // the exit animation has taken over. `remainingMs`/`startedAtMs` are the
  // elapsed-time bookkeeping that lets a pause stop the clock and a resume
  // pick up from where it left off instead of restarting at full duration.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingMsRef = useRef(autoDismissMs ?? 0);
  const startedAtMsRef = useRef(0);

  useEffect(() => {
    if (autoDismissMs === null) return;
    remainingMsRef.current = autoDismissMs;
    startedAtMsRef.current = Date.now();
    timerRef.current = setTimeout(() => setDismissing(true), autoDismissMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // Intentionally only [autoDismissMs]: pause()/resume() below manage the
    // same timer without needing this effect to re-run on every render.
  }, [autoDismissMs]);

  useEffect(() => {
    if (!dismissing) return;
    const timer = setTimeout(() => setVisible(false), EXIT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [dismissing]);

  function pause() {
    if (dismissing || timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    remainingMsRef.current = Math.max(
      remainingMsRef.current - (Date.now() - startedAtMsRef.current),
      0,
    );
  }

  function resume() {
    if (dismissing || timerRef.current !== null) return;
    startedAtMsRef.current = Date.now();
    timerRef.current = setTimeout(() => setDismissing(true), remainingMsRef.current);
  }

  function dragStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (!onSwipeAway || (event.pointerType === "mouse" && event.button !== 0)) return;
    dragRef.current = { x: event.clientX, y: event.clientY, at: Date.now(), sideways: false };
  }

  function dragMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragRef.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.sideways) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
      start.sideways = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    setDragX(dx);
  }

  function dragEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragRef.current;
    dragRef.current = null;
    if (!start?.sideways) return;
    const dx = event.clientX - start.x;
    setDragX(0);
    if (swipeSendsAway(dx, Date.now() - start.at)) {
      // The release of a swipe that began on a button must not press it.
      justSwiped.current = true;
      setTimeout(() => {
        justSwiped.current = false;
      }, 0);
      onSwipeAway?.();
    }
  }

  if (!visible) return null;
  const toast = (
    // biome-ignore lint/a11y/noStaticElementInteractions: the swipe-away drag is a pointer nicety; the toast leaves by itself either way
    <div
      role={role}
      tabIndex={pausable ? 0 : undefined}
      onPointerDown={onSwipeAway ? dragStart : undefined}
      onPointerMove={onSwipeAway ? dragMove : undefined}
      onPointerUp={onSwipeAway ? dragEnd : undefined}
      onPointerCancel={
        onSwipeAway
          ? () => {
              dragRef.current = null;
              setDragX(0);
            }
          : undefined
      }
      onClickCapture={(event) => {
        if (justSwiped.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      style={
        dragX !== 0
          ? {
              transform: `translateX(${dragX}px)`,
              opacity: 1 - Math.min(Math.abs(dragX) / 160, 0.6),
            }
          : undefined
      }
      onMouseEnter={
        pausable
          ? () => {
              hovered.current = true;
              pause();
            }
          : undefined
      }
      onMouseLeave={
        pausable
          ? () => {
              hovered.current = false;
              if (!focused.current) resume();
            }
          : undefined
      }
      onFocusCapture={
        pausable
          ? () => {
              focused.current = true;
              pause();
            }
          : undefined
      }
      onBlurCapture={
        pausable
          ? (event) => {
              if (event.currentTarget.contains(event.relatedTarget)) return;
              focused.current = false;
              if (!hovered.current) resume();
            }
          : undefined
      }
      className={`${className} pointer-events-auto rounded-inset border border-border bg-surface shadow-2xl ${
        onSwipeAway ? "touch-pan-y " : ""
      }${
        pausable ? "focus-visible:focus-ring-inset " : ""
      }${dismissing ? "toast-dismiss" : "rise-in"}`}
    >
      {children}
    </div>
  );
  return placement === "inline" ? (
    <div className="my-2 min-w-0">{toast}</div>
  ) : (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+var(--tabbar-h))] z-50 flex justify-center px-4">
      {toast}
    </div>
  );
}

/**
 * The shared immediate success confirmation. `FormStatus` and `ShopNotice`
 * route successful action outcomes here, so acknowledgements leave after a
 * beat instead of becoming permanent page content. Refusals use `ErrorToast`,
 * and reversible actions offering Undo use `UndoToast`.
 *
 * Mount it fresh (`key`) per occurrence — an identical message twice in a row
 * still needs to visibly land twice.
 */
export function Toast({
  message,
  durationMs = 4000,
  pausable = false,
  occurrenceKey,
}: {
  message: ReactNode;
  durationMs?: number;
  pausable?: boolean;
  /** Action/result identity; changes even when consecutive confirmations say the same thing. */
  occurrenceKey?: Key;
}) {
  return (
    <ToastShell
      key={occurrenceKey}
      autoDismissMs={durationMs}
      pausable={pausable}
      className="px-4 py-3 text-sm font-medium"
    >
      {message}
    </ToastShell>
  );
}

/** Roll-call, checkpoint and medical-reveal refusals stay long enough for eyes on the water to come back. */
export const SAFETY_TOAST_MS = 30_000;

/**
 * **The one error toast.** An error is never drawn as a component that stays on
 * the page (Aaron, 2026-11-13): a refused save, a failed load or a failed
 * assist is said here, in the same pinned slot as a confirmation, and leaves
 * after a longer beat so it can be read. Hovering or focusing it holds it.
 * `FormStatus` and `ShopNotice` route every non-success outcome here, so a
 * form needs no error markup of its own. Field-level validation stays on the
 * field (`Field`'s `error`).
 *
 * Mount it fresh (`key`/`occurrenceKey`) per occurrence.
 */
export function ErrorToast({
  message,
  tone = "danger",
  durationMs = 8000,
  occurrenceKey,
}: {
  message: ReactNode;
  tone?: "danger" | "warning";
  durationMs?: number;
  occurrenceKey?: Key;
}) {
  return (
    <ToastShell
      key={occurrenceKey}
      role="alert"
      autoDismissMs={durationMs}
      pausable
      className={`px-4 py-3 text-sm font-medium ${
        tone === "danger" ? "text-danger" : "text-warning-strong"
      }`}
    >
      {message}
    </ToastShell>
  );
}
