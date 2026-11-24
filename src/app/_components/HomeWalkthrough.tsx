"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { DiveDayIcon } from "@/components/DiveDayIcon";
import { useWalkPress } from "./useWalkPress";

/**
 * One moment of the walkthrough: which step's list item to show, which of its
 * drawn screens, and the sentence that names what happens in it. A step can
 * come up twice (the morning list before Priya signs and after), and can hold
 * more than one screen (the desk, then the boat).
 */
export type WalkBeat = {
  step: string;
  frame: string;
  /** What she is doing, for a reader whose screen reader follows the walk. */
  caption: string;
  /** How long the screen plays on its own before the tap, in ms; the default is a beat with nothing to do first. */
  lead?: number;
  /** How long the tap lasts, in ms; none (0) where the screen's own pointer has just pressed the last control. */
  tapMs?: number;
  /** How long its finished screen stays, in ms; the default is for a screen with a line to read. */
  hold?: number;
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

/** A beat with nothing to do before its tap waits this long (ms) on its first screen. */
export const DEFAULT_LEAD_MS = 700;

/** The tap itself, from a fingertip landing to the finished screen (ms). */
const TAP_MS = 1800;

/**
 * Card 1 holds its first frame this long before its beat starts, so a reader lands on the shop's
 * page and has time to look at it before it moves (ms). It was 3 s (Aaron, 2026-11-20), and a
 * phone reader still saw the page go within a flick of the thumb (Aaron, 2026-11-22).
 */
export const FIRST_CARD_HOLD_MS = 7000;

/** How long the finished screen stays for reading (ms), about a hundred seconds a walk (Aaron, 2026-11-18). */
const HOLD_AFTER_MS = 4200;

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
  const sliding = useRef(false);
  // How full the current beat's segment is, 0 to 1. Written straight to the
  // segment so a frame of the fill is not a render of the page.
  const progress = useRef(0);
  // What is left of the first card's hold on its first frame, in ms.
  const intro = useRef(0);
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
    const before = list.getBoundingClientRect().height;
    // The new beat starts on its first screen: set that now, so the height measured below is the
    // one the slide will have (the old phase's grown and shrunk rows would make it jump after).
    list.setAttribute("data-walk-phase", "before");
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
    // Slides differ in height, and the page under them would jump by the difference (a phone has
    // no anchoring to hide it). Reserving the tallest slide's height would leave most of them
    // with a hand's width of nothing, so the page glides the difference instead.
    const after = list.getBoundingClientRect().height;
    if (
      before > 0 &&
      Math.abs(after - before) > 1 &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      typeof list.animate === "function"
    ) {
      list.animate(
        [
          { height: `${before}px`, overflow: "hidden" },
          { height: `${after}px`, overflow: "hidden" },
        ],
        { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    }
  }, [beat]);

  // It plays only while the current slide's own screen is well in view (a third of it), not the whole tall list:
  // a reader who has scrolled to the controls has not yet reached the screen, and the first card's
  // hold runs only from the moment they do (Aaron, 2026-11-21).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the beat is the trigger; the frame is found in the list
  useEffect(() => {
    const target =
      rootRef.current?.querySelector<HTMLElement>("[data-walk-frame-current]") ?? rootRef.current;
    if (!target) return;
    const watcher = new IntersectionObserver(
      ([entry]) => setOnScreen(entry?.isIntersecting ?? false),
      { threshold: 0.3 },
    );
    watcher.observe(target);
    return () => watcher.disconnect();
  }, [beat]);

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

  // A beat opened by hand or by the clock starts with an empty segment, on its first frame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the index is the trigger
  useEffect(() => {
    progress.current = 0;
    intro.current = index === 0 ? FIRST_CARD_HOLD_MS : 0;
    listEl()?.toggleAttribute("data-walk-idle", intro.current > 0);
    if (fillRef.current) fillRef.current.style.transform = "scaleX(0)";
    setPhase("before");
  }, [index]);

  const running = playing && onScreen && tabVisible && !held;
  // A walk that is not running holds where it is: stopped mid-play it keeps the frame it reached,
  // and a slide opened while it is stopped waits on its first frame (`globals.css`).
  // biome-ignore lint/correctness/useExhaustiveDependencies: listEl reads a ref, and running is the trigger
  useEffect(() => {
    listEl()?.toggleAttribute("data-walk-still", !running);
  }, [running]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a move by hand restarts the beat's clock
  useEffect(() => {
    if (!running) return;
    const lead = beats[index]?.lead ?? DEFAULT_LEAD_MS;
    const tapMs = beats[index]?.tapMs ?? TAP_MS;
    const beatMs = lead + tapMs + (beats[index]?.hold ?? HOLD_AFTER_MS);
    const tapAt = lead / beatMs;
    const afterAt = (lead + tapMs) / beatMs;
    listEl()?.style.setProperty("--walk-tap-ms", `${tapMs}ms`);
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      if (intro.current > 0) {
        intro.current -= now - last;
        last = now;
        if (intro.current <= 0) listEl()?.removeAttribute("data-walk-idle");
        frame = window.requestAnimationFrame(tick);
        return;
      }
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

  const { onPointerDown, onPointerMove, onPointerUp, onPointerEnd } = useWalkPress({
    rootRef,
    sliding,
    index,
    total,
    beats,
    go,
    onHeld: setHeld,
  });

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
      onPointerCancel={onPointerEnd}
      onPointerLeave={onPointerEnd}
      className="relative scroll-mt-20 overflow-x-clip"
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
          <p className="sr-only" aria-live={playing ? "off" : "polite"}>
            {beat?.caption}
          </p>
          <div className="mt-3 flex gap-1.5">
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
