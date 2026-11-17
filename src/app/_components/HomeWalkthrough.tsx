"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { DiveDayIcon } from "@/components/DiveDayIcon";
import { useWalkSwipe } from "./useWalkSwipe";

/**
 * One moment of the walkthrough: which step's list item to show, which of its
 * drawn screens, and the sentence that names what happens in it. A step can
 * come up twice (the morning list before Priya signs and after), and can hold
 * more than one screen (the desk, then the boat).
 */
export type WalkBeat = {
  step: string;
  frame: string;
  caption: string;
  /** She types into this screen first, so its beat runs longer and taps later. */
  typed?: boolean;
};

export type WalkLabels = {
  label: string;
  position: string;
  pause: string;
  play: string;
  previous: string;
  next: string;
  /** A segment of the bar, which jumps to its step: "Go to step {n}". */
  goTo: string;
  hint: string;
};

/** The whole walk takes two and a half minutes, about ten seconds a slide (Aaron, 2026-11-17). */
const WALK_MS = 150_000;

/** A beat she types into runs this much longer than the rest, so the typing is read before the tap. */
const TYPED_FACTOR = 1.5;

/** Fewer than this many pixels sideways is a tap, not a swipe. */
const SWIPE_PX = 40;

/** A press that has moved this far sideways, more than up or down, is a drag. */
const DRAG_START_PX = 8;

/**
 * Where in a beat a tap happens, as shares of its clock: a fingertip lands on
 * the control from `TAP_AT` and the screen swaps to the finished one at
 * `AFTER_AT`. Only frames drawn with a `before` have anything to show for it.
 */
const TAP_AT = 0.1;
const AFTER_AT = 0.3;
/** The same for a beat she types into: the typing comes first. */
const TYPED_TAP_AT = 0.4;
const TYPED_AFTER_AT = 0.58;

/** A press held this long is a hold (it pauses, and its release is not a tap). */
const HOLD_MS = 250;

/**
 * **The homepage's booking, one step at a time.** It wraps the server-rendered
 * list of steps (`STEPS` in `src/app/(marketing)/page.tsx`) and changes nothing
 * about it: with no script, or before this one runs, the reader has the full
 * list. Once it runs, it marks the list as a walk (`data-walk`) and says which
 * item and which drawn screen are current; the list's own classes do the
 * hiding, so the server HTML stays the one place the steps are written.
 *
 * It follows one diver, so the beats come from the page in the order the
 * story goes, not the order the list is read in.
 *
 * Motion: it advances itself only when the reader has not asked for reduced
 * motion, only while it is on screen and the tab is visible, and the Pause
 * button is always there. A tap on a screen (its left third goes back, the
 * rest forward), a swipe, the arrow keys and the buttons move it by hand and
 * never start it. A swipe is a drag: the beat follows the finger, then slides
 * out and the next slides in, and a short drag springs back.
 *
 * **The bar is the clock.** One segment per beat; the current one fills over
 * the beat's share of the walk and the beat moves on when it is full, so what
 * the reader sees is what the player waits for. Holding a finger or the mouse
 * down anywhere on the walk freezes it, and letting go carries on from the
 * same place (Instagram's stories, which Aaron named, 2026-11-17).
 */
export function HomeWalkthrough({
  beats,
  labels,
  children,
}: {
  beats: readonly WalkBeat[];
  labels: WalkLabels;
  children: ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [held, setHeld] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  // The controls are for a reader whose script ran; without it they are not drawn.
  const [ready, setReady] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const swipeFrom = useRef<number | null>(null);
  const swipeFromY = useRef(0);
  const dragging = useRef(false);
  const sliding = useRef(false);
  const pressedAt = useRef(0);
  // How full the current beat's segment is, 0 to 1. Written straight to the
  // segment so a frame of the fill is not a render of the page.
  const progress = useRef(0);
  const fillRef = useRef<HTMLSpanElement>(null);
  const total = beats.length;
  const beat = beats[index] ?? beats[0];

  // Mark the list as a walk once, and start it unless motion is unwelcome.
  useEffect(() => {
    rootRef.current?.querySelector("[data-walk-list]")?.setAttribute("data-walk", "");
    setPlaying(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    setReady(true);
  }, []);

  // Which list item and which screen are current.
  useEffect(() => {
    const list = rootRef.current?.querySelector("[data-walk-list]");
    if (!list || !beat) return;
    for (const item of list.querySelectorAll("[data-walk-step]")) {
      const current = item.getAttribute("data-walk-step") === beat.step;
      item.toggleAttribute("data-walk-current", current);
      for (const frame of item.querySelectorAll("[data-walk-frame]")) {
        frame.toggleAttribute(
          "data-walk-frame-current",
          current && frame.getAttribute("data-walk-frame") === beat.frame,
        );
      }
    }
  }, [beat]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const watcher = new IntersectionObserver(
      ([entry]) => setOnScreen(entry?.isIntersecting ?? false),
      {
        threshold: 0.25,
      },
    );
    watcher.observe(root);
    return () => watcher.disconnect();
  }, []);

  useEffect(() => {
    const sync = () => setTabVisible(!document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const listEl = () => rootRef.current?.querySelector<HTMLElement>("[data-walk-list]") ?? null;

  const setPhase = (phase: "before" | "tap" | "after") => {
    const list = rootRef.current?.querySelector("[data-walk-list]");
    if (list && list.getAttribute("data-walk-phase") !== phase) {
      list.setAttribute("data-walk-phase", phase);
    }
  };

  // A new beat starts with an empty segment, on its first screen when it is
  // playing and on its finished one when it is not (a reader who stopped it,
  // or asked for no motion, gets the screen that says the most).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the index and playing are the trigger
  useEffect(() => {
    progress.current = 0;
    setPhase(playing ? "before" : "after");
  }, [index, playing]);

  const running = playing && onScreen && tabVisible && !held;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a move by hand restarts the beat's clock
  useEffect(() => {
    if (!running) return;
    const typed = beats[index]?.typed === true;
    const tapAt = typed ? TYPED_TAP_AT : TAP_AT;
    const afterAt = typed ? TYPED_AFTER_AT : AFTER_AT;
    const beatMs = (WALK_MS / total) * (typed ? TYPED_FACTOR : 1);
    listEl()?.style.setProperty("--walk-tap-ms", `${(afterAt - tapAt) * beatMs}ms`);
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      progress.current = Math.min(1, progress.current + (now - last) / beatMs);
      last = now;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${progress.current})`;
      setPhase(
        progress.current >= afterAt ? "after" : progress.current >= tapAt ? "tap" : "before",
      );
      if (progress.current >= 1) {
        setIndex((i) => (i + 1) % total);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [running, index, total, beats]);

  const go = (to: number) => setIndex(((to % total) + total) % total);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest("a")) return;
    if (event.key === "ArrowRight") go(index + 1);
    else if (event.key === "ArrowLeft") go(index - 1);
    else return;
    event.preventDefault();
  };

  const { dragBy, springBack, slide } = useWalkSwipe({
    rootRef,
    sliding,
    index,
    total,
    beats,
    playing,
    go,
  });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (sliding.current) return;
    swipeFrom.current = event.clientX;
    swipeFromY.current = event.clientY;
    dragging.current = false;
    pressedAt.current = performance.now();
    setHeld(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const from = swipeFrom.current;
    if (from === null) return;
    const dx = event.clientX - from;
    if (!dragging.current) {
      const dy = event.clientY - swipeFromY.current;
      if (Math.abs(dx) < DRAG_START_PX || Math.abs(dy) > Math.abs(dx)) return;
      dragging.current = true;
      // From here the drag is the walk's, wherever the finger goes.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    dragBy(dx);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const from = swipeFrom.current;
    swipeFrom.current = null;
    const wasDragging = dragging.current;
    dragging.current = false;
    setHeld(false);
    if (from === null) return;
    const moved = event.clientX - from;
    if (Math.abs(moved) >= SWIPE_PX) {
      slide(moved < 0 ? 1 : -1, wasDragging ? moved : 0);
    } else if (wasDragging) {
      springBack(moved);
    } else if (
      performance.now() - pressedAt.current < HOLD_MS &&
      event.target instanceof HTMLElement &&
      event.target.closest("[data-walk-frame]") &&
      !event.target.closest("a, button")
    ) {
      // Instagram's stories: the left edge of a screen goes back, the rest on.
      const rect = event.target.closest("[data-walk-frame]")?.getBoundingClientRect();
      const back = rect && rect.width > 0 && event.clientX < rect.left + rect.width * 0.3;
      go(index + (back ? -1 : 1));
    }
  };

  const release = () => {
    const wasDragging = dragging.current;
    swipeFrom.current = null;
    dragging.current = false;
    setHeld(false);
    if (wasDragging) springBack(0);
  };

  const toggle = (
    <button
      type="button"
      onClick={() => setPlaying((p) => !p)}
      aria-pressed={playing}
      className="inline-flex min-h-11 items-center rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-foreground"
    >
      {playing ? labels.pause : labels.play}
    </button>
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group is the pattern for a stepper
    <div
      ref={rootRef}
      role="group"
      aria-roledescription="walkthrough"
      aria-label={labels.label}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={release}
      onPointerLeave={release}
      className="relative scroll-mt-20 touch-pan-y overflow-x-clip"
    >
      {ready ? (
        <>
          <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2" data-walk-controls>
            {toggle}
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label={labels.previous}
              className="inline-flex size-11 items-center justify-center rounded-lg border border-border bg-surface text-foreground"
            >
              <DiveDayIcon name="chevron-left" className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label={labels.next}
              className="inline-flex size-11 items-center justify-center rounded-lg border border-border bg-surface text-foreground"
            >
              <DiveDayIcon name="chevron-right" className="size-4" />
            </button>
            <p className="text-sm text-muted tabular-nums">
              {labels.position.replace("{n}", String(index + 1)).replace("{total}", String(total))}
            </p>
          </div>
          <p
            className="mt-3 min-h-14 max-w-4xl text-lg leading-7 text-balance sm:min-h-8"
            aria-live={playing ? "off" : "polite"}
          >
            {beat?.caption}
          </p>
          <div className="mt-1 flex gap-1.5">
            {beats.map((b, i) => (
              // Each segment is a door to its step: tall enough to hit, thin to look at.
              <button
                type="button"
                key={`${b.step}-${b.frame}`}
                onClick={() => go(i)}
                aria-label={labels.goTo.replace("{n}", String(i + 1))}
                aria-current={i === index ? "step" : undefined}
                className="group flex h-6 flex-1 items-center"
              >
                <span className="block h-1 w-full overflow-hidden rounded-full bg-border transition-[height] group-hover:h-1.5">
                  {i < index ? (
                    <span className="block size-full bg-primary" />
                  ) : i === index ? (
                    <span
                      key={index}
                      ref={fillRef}
                      className="block size-full origin-left bg-primary"
                      style={{ transform: "scaleX(0)" }}
                    />
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      {children}
      {ready ? <p className="mt-4 text-sm text-muted">{labels.hint}</p> : null}
    </div>
  );
}
