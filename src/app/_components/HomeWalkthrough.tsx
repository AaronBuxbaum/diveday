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

/**
 * One moment of the walkthrough: which step's list item to show, which of its
 * drawn screens, and the sentence that names what happens in it. A step can
 * come up twice (the morning list before Priya signs and after), and can hold
 * more than one screen (the desk, then the boat).
 */
export type WalkBeat = { step: string; frame: string; caption: string };

export type WalkLabels = {
  label: string;
  position: string;
  pause: string;
  play: string;
  previous: string;
  next: string;
  hint: string;
};

/** The whole walk takes about a minute and a half (Aaron, 2026-11-17). */
const WALK_MS = 90_000;

/** Fewer than this many pixels sideways is a tap, not a swipe. */
const SWIPE_PX = 40;

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
 * button is always there. A tap on a screen, a swipe, the arrow keys and the
 * buttons move it by hand and never start it.
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

  // A new beat starts with an empty segment.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the index is the trigger
  useEffect(() => {
    progress.current = 0;
  }, [index]);

  const running = playing && onScreen && tabVisible && !held;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a move by hand restarts the beat's clock
  useEffect(() => {
    if (!running) return;
    const beatMs = WALK_MS / total;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      progress.current = Math.min(1, progress.current + (now - last) / beatMs);
      last = now;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${progress.current})`;
      if (progress.current >= 1) {
        setIndex((i) => (i + 1) % total);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [running, index, total]);

  const go = (to: number) => setIndex(((to % total) + total) % total);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest("a")) return;
    if (event.key === "ArrowRight") go(index + 1);
    else if (event.key === "ArrowLeft") go(index - 1);
    else return;
    event.preventDefault();
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    swipeFrom.current = event.clientX;
    pressedAt.current = performance.now();
    setHeld(true);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const from = swipeFrom.current;
    swipeFrom.current = null;
    setHeld(false);
    if (from === null) return;
    const moved = event.clientX - from;
    if (Math.abs(moved) >= SWIPE_PX) {
      go(index + (moved < 0 ? 1 : -1));
    } else if (
      performance.now() - pressedAt.current < HOLD_MS &&
      event.target instanceof HTMLElement &&
      event.target.closest("[data-walk-frame]") &&
      !event.target.closest("a, button")
    ) {
      go(index + 1);
    }
  };

  const release = () => {
    swipeFrom.current = null;
    setHeld(false);
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
      onPointerUp={onPointerUp}
      onPointerCancel={release}
      onPointerLeave={release}
      className="scroll-mt-20 touch-pan-y"
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
            className="mt-3 min-h-14 max-w-2xl text-lg leading-7 text-balance sm:min-h-8"
            aria-live={playing ? "off" : "polite"}
          >
            {beat?.caption}
          </p>
          <div className="mt-3 flex gap-1.5" aria-hidden="true">
            {beats.map((b, i) => (
              <span
                key={`${b.step}-${b.frame}`}
                className="h-1 flex-1 overflow-hidden rounded-full bg-border"
              >
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
            ))}
          </div>
        </>
      ) : null}
      {children}
      {ready ? <p className="mt-4 text-sm text-muted">{labels.hint}</p> : null}
    </div>
  );
}
