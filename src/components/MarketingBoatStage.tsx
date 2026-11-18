"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { drawBoatScene } from "@/components/marketing-boat-renderer";
import { buttonClass } from "@/components/ui/button";
import { StatusMark } from "@/components/ui/StatusMark";

export type BoatStageLabels = {
  rotateLeft: string;
  rotateRight: string;
  pause: string;
  resume: string;
  dragHint: string;
  markerOpen: string;
  markerClosed: string;
  name: string;
};

const TURN_STEP = Math.PI / 9;
const CONTROL_PATHS = {
  left: "M9 5 4 10l5 5 M5 10h9a5 5 0 0 1 0 10",
  right: "m15 5 5 5-5 5 M19 10h-9a5 5 0 0 0 0 10",
  pause: "M9 6v12 M15 6v12",
  resume: "m8 5 11 7-11 7z",
};

function SceneButton({
  icon,
  label,
  onClick,
}: {
  icon: keyof typeof CONTROL_PATHS;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-try-tap=""
      title={label}
      aria-label={label}
      onClick={onClick}
      className={buttonClass({ variant: "ghost", size: "icon-sm" })}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-5"
      >
        <path d={CONTROL_PATHS[icon]} />
      </svg>
    </button>
  );
}

export function MarketingBoatStage({
  labels,
  poster,
  aboard,
  onConfirm,
}: {
  labels: BoatStageLabels;
  poster: ReactNode;
  aboard: boolean;
  onConfirm: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markerRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef<{ id: number; x: number } | null>(null);
  const yaw = useRef(0);
  const invalidate = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const settings = useRef({ aboard, paused });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (
      !canvas ||
      typeof IntersectionObserver === "undefined" ||
      typeof ResizeObserver === "undefined"
    )
      return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let inView = false;
    let painted = false;
    let frame = 0;
    let lastFrame: number | null = null;
    let width = 0;
    let height = 0;
    let time = 0;
    let progress = 0;
    let confirmOrbit = 0;
    let easeCamera = false;
    let seafloor: HTMLImageElement | undefined;
    let reefSettled = false;
    let reefTimeout: number | undefined;
    const reef = new Image();
    reef.decoding = "async";
    function showScene() {
      window.clearTimeout(reefTimeout);
      reefSettled = true;
      schedule();
    }
    reef.onload = () => {
      seafloor = reef;
      showScene();
    };
    reef.onerror = showScene;

    function schedule() {
      if (reefSettled && inView && !document.hidden && !frame) frame = requestAnimationFrame(paint);
    }

    function paint(now: number) {
      frame = 0;
      if (!canvas || !ctx || !inView || document.hidden || !width || !height) return;
      const animate = !settings.current.paused && !motion.matches;
      if (animate && lastFrame !== null && now - lastFrame < 30) {
        schedule();
        return;
      }
      const elapsed = lastFrame === null ? 0 : Math.min((now - lastFrame) / 1000, 0.08);
      lastFrame = animate ? now : null;
      if (animate) time += elapsed;
      if (!settings.current.aboard) {
        progress = 0;
        confirmOrbit = 0;
      } else {
        if (progress === 0) easeCamera = animate;
        if (!animate) easeCamera = false;
        progress = animate ? Math.min(1, progress + elapsed / 0.8) : 1;
        if (easeCamera) confirmOrbit = 0.42 * progress * progress * (3 - 2 * progress);
      }

      const heading = yaw.current + confirmOrbit;
      const idleOrbit = 0.12 * Math.sin((time * 2 * Math.PI) / 14);
      const anchor = drawBoatScene(
        ctx,
        width,
        height,
        heading + idleOrbit,
        time,
        progress,
        seafloor,
      );
      if (seafloor && canvas.dataset.boatReef !== "ready") canvas.dataset.boatReef = "ready";
      if (canvas.dataset.boatYaw !== String(heading)) canvas.dataset.boatYaw = String(heading);
      if (markerRef.current) {
        markerRef.current.style.left = `clamp(3.75rem, ${anchor.x}px, calc(100% - 3.75rem))`;
        markerRef.current.style.top = `max(3rem, ${anchor.y - 8}px)`;
      }
      if (!painted) {
        painted = true;
        setReady(true);
      }
      if (animate) schedule();
    }

    function resize() {
      if (!canvas || !ctx) return;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      schedule();
    }

    function updateVisibility() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      lastFrame = null;
      schedule();
    }

    const visibility = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? false;
      if (inView && !reef.src) {
        reefTimeout = window.setTimeout(showScene, 2500);
        reef.src = "/marketing/boat-reef.webp";
      }
      updateVisibility();
    });
    visibility.observe(canvas);
    const size = new ResizeObserver(resize);
    size.observe(canvas);
    resize();
    invalidate.current = schedule;
    motion.addEventListener("change", updateVisibility);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      invalidate.current = null;
      window.clearTimeout(reefTimeout);
      reef.onload = null;
      reef.onerror = null;
      visibility.disconnect();
      size.disconnect();
      motion.removeEventListener("change", updateVisibility);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    settings.current = { aboard, paused };
    invalidate.current?.();
  }, [aboard, paused]);

  function rotate(delta: number) {
    yaw.current += delta;
    invalidate.current?.();
  }

  function keyRotate(event: KeyboardEvent<HTMLFieldSetElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    rotate(event.key === "ArrowLeft" ? -TURN_STEP : TURN_STEP);
  }

  function startDrag(event: PointerEvent<HTMLCanvasElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    pointer.current = { id: event.pointerId, x: event.clientX };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function drag(event: PointerEvent<HTMLCanvasElement>) {
    const previous = pointer.current;
    if (previous?.id !== event.pointerId) return;
    rotate(((event.clientX - previous.x) / event.currentTarget.clientWidth) * Math.PI * 2);
    previous.x = event.clientX;
  }

  return (
    <div data-boat-scene="" className="relative isolate aspect-[3/2] w-full overflow-hidden">
      <div className="absolute inset-0">{poster}</div>
      <div aria-hidden="true">
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 size-full touch-pan-y cursor-grab active:cursor-grabbing ${ready ? "" : "invisible"}`}
          onPointerDown={startDrag}
          onPointerMove={drag}
          onLostPointerCapture={() => {
            pointer.current = null;
          }}
        />
      </div>
      <fieldset aria-label={labels.dragHint} onKeyDown={keyRotate} hidden={!ready}>
        <button
          ref={markerRef}
          type="button"
          data-try-tap=""
          aria-label={aboard ? labels.markerClosed : labels.markerOpen}
          aria-disabled={aboard}
          onClick={() => {
            if (!aboard) onConfirm();
          }}
          className="absolute z-10 flex min-h-11 w-max min-w-11 -translate-x-1/2 -translate-y-full cursor-pointer items-end justify-center pb-1 focus-visible:outline-offset-0"
        >
          <span className="relative flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-foreground shadow-bed after:absolute after:top-full after:start-1/2 after:h-2 after:w-px after:bg-foreground">
            <StatusMark
              variant={aboard ? "success" : "pending"}
              className={aboard ? "text-success" : "text-primary"}
            />
            {labels.name}
          </span>
        </button>
        <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between gap-1 sm:inset-x-3 sm:bottom-3">
          <span className="rounded-lg bg-surface/95 px-2 py-1 text-xs font-medium text-muted">
            {labels.dragHint}
          </span>
          <div className="pointer-events-auto flex rounded-lg border border-border bg-surface/95 shadow-bed">
            <SceneButton icon="left" label={labels.rotateLeft} onClick={() => rotate(-TURN_STEP)} />
            <SceneButton
              icon="right"
              label={labels.rotateRight}
              onClick={() => rotate(TURN_STEP)}
            />
            <div className="border-s border-border motion-reduce:hidden">
              <SceneButton
                icon={paused ? "resume" : "pause"}
                label={paused ? labels.resume : labels.pause}
                onClick={() => setPaused(!paused)}
              />
            </div>
          </div>
        </div>
      </fieldset>
    </div>
  );
}
