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

export const DIVER_INDICES = [0, 1] as const;
export type DiverIndex = (typeof DIVER_INDICES)[number];
type BoatDiverLabels = {
  name: string;
  shortName: string;
  place: string;
  gear: string;
  marker: string;
  select: string;
  confirm: string;
  dockConfirm: string;
};

export type BoatStageLabels = {
  rotateLeft: string;
  rotateRight: string;
  pause: string;
  resume: string;
  dragHint: string;
  overview: string;
  divers: [BoatDiverLabels, BoatDiverLabels];
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

function useBoatCanvas({
  checked,
  selected,
  paused,
  atReef,
}: {
  checked: [boolean, boolean];
  selected: DiverIndex | null;
  paused: boolean;
  atReef: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markers = useRef<(HTMLButtonElement | null)[]>([]);
  const yaw = useRef(0);
  const invalidate = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const settings = useRef({ checked, selected, paused, atReef });

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
    let voyage = 0;
    const progress: [number, number] = [0, 0];
    const focus: [number, number] = [0, 0];
    let cameraYaw = 0;
    let seafloor: HTMLImageElement | undefined;
    let harborWater: HTMLImageElement | undefined;
    let dockReady = false;
    let dockTimeout: number | undefined;
    const harbor = new Image();
    harbor.decoding = "async";

    function showDock() {
      window.clearTimeout(dockTimeout);
      dockReady = true;
      schedule();
    }
    harbor.onload = () => {
      harborWater = harbor;
      showDock();
    };
    harbor.onerror = showDock;
    const reef = new Image();
    reef.decoding = "async";
    reef.onload = () => {
      seafloor = reef;
      schedule();
    };

    function schedule() {
      if ((dockReady || settings.current.atReef) && inView && !document.hidden && !frame)
        frame = requestAnimationFrame(paint);
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
      const { checked: marks, selected: subject } = settings.current;
      const ease = animate ? 1 - Math.exp(-elapsed * 10) : 1;
      for (const index of DIVER_INDICES) {
        const target = subject === index ? 1 : 0;
        const remaining = target - focus[index];
        focus[index] += Math.abs(remaining) < 0.001 ? remaining : remaining * ease;
        progress[index] = marks[index]
          ? animate && painted
            ? Math.min(1, progress[index] + elapsed / 0.8)
            : 1
          : 0;
      }
      const yawDelta = yaw.current - cameraYaw;
      const remainingYaw = Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta));
      cameraYaw =
        !animate || Math.abs(remainingYaw) < 0.001 ? yaw.current : cameraYaw + remainingYaw * ease;
      const idleOrbit = 0.12 * Math.sin((time * 2 * Math.PI) / 14);
      voyage = settings.current.atReef
        ? animate && painted
          ? Math.min(1, voyage + elapsed / 1.5)
          : 1
        : 0;
      const reefMix = voyage * voyage * (3 - 2 * voyage);
      const anchors = drawBoatScene(
        ctx,
        width,
        height,
        cameraYaw + idleOrbit,
        time,
        progress,
        seafloor,
        focus,
        reefMix,
        harborWater,
      );
      if (harborWater && canvas.dataset.boatHarbor !== "ready") canvas.dataset.boatHarbor = "ready";
      if (seafloor && canvas.dataset.boatReef !== "ready") canvas.dataset.boatReef = "ready";
      if (canvas.dataset.boatYaw !== String(cameraYaw)) canvas.dataset.boatYaw = String(cameraYaw);
      const focusName = subject === null ? "overview" : subject === 0 ? "priya" : "tom";
      if (canvas.dataset.boatFocus !== focusName) canvas.dataset.boatFocus = focusName;
      // Narrow end-on views can project both heads into the same 44px touch target.
      const overlap =
        subject === null &&
        Math.abs(anchors[0].x - anchors[1].x) < 74 &&
        Math.abs(anchors[0].y - anchors[1].y) < 44;
      for (const index of DIVER_INDICES) {
        const marker = markers.current[index];
        if (!marker) continue;
        const anchor = anchors[index];
        const lift = overlap && index === (anchors[0].y <= anchors[1].y ? 0 : 1) ? 44 : 0;
        marker.style.left = `clamp(2.25rem, ${anchor.x}px, calc(100% - 2.25rem))`;
        marker.style.top = `max(2.75rem, ${anchor.y - 6 - lift}px)`;
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
      if (inView && !harbor.src) {
        dockTimeout = window.setTimeout(showDock, 2500);
        harbor.src = "/marketing/boat-harbor-water.webp";
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
      window.clearTimeout(dockTimeout);
      harbor.onload = null;
      harbor.onerror = null;
      reef.onload = null;
      visibility.disconnect();
      size.disconnect();
      motion.removeEventListener("change", updateVisibility);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    // A fresh inspection starts at the modeled side of the deck. Manual orbit
    // remains relative to that subject until another name or the overview is chosen.
    if (settings.current.atReef !== atReef || settings.current.selected !== selected)
      yaw.current = 0;
    settings.current = { checked, selected, paused, atReef };
    invalidate.current?.();
  }, [checked, selected, paused, atReef]);

  function rotate(delta: number) {
    yaw.current += delta;
    invalidate.current?.();
  }

  return { canvasRef, markers, ready, rotate };
}

export function MarketingBoatStage({
  labels,
  poster,
  atReef,
  checked,
  selected,
  onSelect,
  onOverview,
}: {
  labels: BoatStageLabels;
  poster: ReactNode;
  atReef: boolean;
  checked: [boolean, boolean];
  selected: DiverIndex | null;
  onSelect: (index: DiverIndex) => void;
  onOverview: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const pointer = useRef<{ id: number; x: number } | null>(null);
  const markerTouch = useRef<{ id: number; x: number; y: number } | null>(null);
  const { canvasRef, markers, ready, rotate } = useBoatCanvas({
    checked,
    selected,
    paused,
    atReef,
  });

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
    <div
      data-boat-scene=""
      data-boat-phase={atReef ? "reef" : "dock"}
      className="relative isolate aspect-[3/2] w-full overflow-hidden"
    >
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
      <fieldset
        aria-label={labels.dragHint}
        onKeyDown={keyRotate}
        hidden={!ready && selected === null}
      >
        {DIVER_INDICES.map((index) => {
          const diver = labels.divers[index];
          return (
            <button
              key={diver.name}
              ref={(node) => {
                markers.current[index] = node;
              }}
              type="button"
              data-try-tap=""
              aria-label={diver.marker}
              aria-pressed={selected === index}
              hidden={!ready || (selected !== null && selected !== index)}
              onPointerDown={(event) => {
                if (event.pointerType === "touch" && event.isPrimary) {
                  markerTouch.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
                }
              }}
              onPointerCancel={() => {
                markerTouch.current = null;
              }}
              onPointerUp={(event) => {
                const start = markerTouch.current;
                markerTouch.current = null;
                // Browsers can suppress click on the tap immediately following a pan.
                if (
                  start?.id === event.pointerId &&
                  Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8
                )
                  onSelect(index);
              }}
              onClick={() => onSelect(index)}
              className="absolute z-10 flex min-h-11 w-max min-w-11 -translate-x-1/2 -translate-y-full touch-manipulation cursor-pointer items-end justify-center pb-1 focus-visible:focus-ring-inset"
            >
              <span className="relative flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-1 text-xs font-semibold text-foreground shadow-bed after:absolute after:top-full after:start-1/2 after:h-2 after:w-px after:bg-foreground">
                <StatusMark
                  variant={checked[index] ? "success" : "pending"}
                  className={checked[index] ? "text-success" : "text-primary"}
                />
                {diver.shortName}
              </span>
            </button>
          );
        })}
        <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between gap-1 sm:inset-x-3 sm:bottom-3">
          {selected !== null ? (
            <button
              type="button"
              data-try-tap=""
              onClick={onOverview}
              className={buttonClass({
                variant: "secondary",
                size: "sm",
                className: "pointer-events-auto",
              })}
            >
              {labels.overview}
            </button>
          ) : (
            <span className="rounded-lg bg-surface/95 px-2 py-1 text-xs font-medium text-muted">
              {labels.dragHint}
            </span>
          )}
          <div
            hidden={!ready}
            className="pointer-events-auto flex rounded-lg border border-border bg-surface/95 shadow-bed"
          >
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
