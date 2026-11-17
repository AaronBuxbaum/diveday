"use client";

import { type RefObject, useRef } from "react";
import { flushSync } from "react-dom";
import type { WalkBeat } from "./HomeWalkthrough";

/** The gap between a beat and the one beside it while they slide, in pixels. */
const SLIDE_GAP_PX = 24;

/** How long a beat takes to finish its slide once the finger lets go. */
const SLIDE_MS = 240;

/**
 * The walkthrough's Instagram-style swipe: while a finger drags, the beat follows it and a copy of
 * the beat beside it (the neighbor) follows the beat, so a swipe brings the next one in instead of
 * bouncing the current one back. `go` runs only when the neighbor has taken the list's place.
 */
export function useWalkSwipe({
  rootRef,
  sliding,
  index,
  total,
  beats,
  playing,
  go,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  sliding: RefObject<boolean>;
  index: number;
  total: number;
  beats: readonly WalkBeat[];
  playing: boolean;
  go: (to: number) => void;
}) {
  const listEl = () => rootRef.current?.querySelector<HTMLElement>("[data-walk-list]") ?? null;
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** The beat beside this one, drawn from the list's own markup, waiting just off to its side. */
  const neighbor = useRef<{ el: HTMLElement; dir: 1 | -1 } | null>(null);

  const removeNeighbor = () => {
    neighbor.current?.el.remove();
    neighbor.current = null;
  };

  const clearDrag = () => {
    const el = listEl();
    if (el) {
      el.style.transform = "";
    }
    removeNeighbor();
  };

  /**
   * A copy of the list showing the next (`dir` 1) or previous (-1) beat, laid over the list's own
   * box, so a drag has something coming in behind the beat it is moving (Instagram's stories).
   * The list's markup carries every beat's state in attributes, so the copy needs no render of
   * its own: it only has its current step and frame moved on.
   */
  const makeNeighbor = (dir: 1 | -1) => {
    const el = listEl();
    const root = rootRef.current;
    if (!el || !root) return;
    const to = beats[(((index + dir) % total) + total) % total];
    if (!to) return;
    const copy = el.cloneNode(true) as HTMLElement;
    copy.removeAttribute("data-walk-list");
    copy.setAttribute("aria-hidden", "true");
    copy.setAttribute("inert", "");
    copy.setAttribute("data-walk-phase", playing ? "before" : "after");
    for (const item of copy.querySelectorAll("[data-walk-step]")) {
      const current = item.getAttribute("data-walk-step") === to.step;
      item.toggleAttribute("data-walk-current", current);
      for (const frame of item.querySelectorAll("[data-walk-frame]")) {
        frame.toggleAttribute(
          "data-walk-frame-current",
          current && frame.getAttribute("data-walk-frame") === to.frame,
        );
      }
    }
    const style = copy.style;
    style.position = "absolute";
    style.left = `${el.offsetLeft}px`;
    style.top = `${el.offsetTop}px`;
    style.width = `${el.offsetWidth}px`;
    style.margin = "0";
    style.pointerEvents = "none";
    root.insertBefore(copy, el);
    neighbor.current = { el: copy, dir };
    placeNeighbor(0);
  };

  /** Where the neighbor sits for a drag of `dx`: one list-width and a gap off to the far side. */
  const placeNeighbor = (dx: number) => {
    const el = listEl();
    const n = neighbor.current;
    if (!el || !n) return;
    n.el.style.transform = `translateX(${dx + n.dir * (el.offsetWidth + SLIDE_GAP_PX)}px)`;
  };

  /** The beat follows the finger and the one beside it follows the beat. */
  const dragBy = (dx: number) => {
    const el = listEl();
    if (!el) return;
    const dir = dx < 0 ? 1 : -1;
    if (neighbor.current?.dir !== dir) {
      removeNeighbor();
      if (!reducedMotion()) makeNeighbor(dir);
    }
    el.style.transform = `translateX(${dx}px)`;
    placeNeighbor(dx);
  };

  const animateTo = (el: HTMLElement, from: string, to: string) =>
    el.animate([{ transform: from }, { transform: to }], {
      duration: SLIDE_MS,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      fill: "forwards",
    });

  /** A short drag lets go: both beats settle back where they were. */
  const springBack = (dx: number) => {
    const el = listEl();
    const n = neighbor.current;
    if (!el || !n || typeof el.animate !== "function") {
      clearDrag();
      return;
    }
    const gap = n.dir * (el.offsetWidth + SLIDE_GAP_PX);
    const own = animateTo(el, `translateX(${dx}px)`, "translateX(0)");
    animateTo(n.el, `translateX(${dx + gap}px)`, `translateX(${gap}px)`);
    own.onfinish = () => {
      clearDrag();
      own.cancel();
    };
  };

  /**
   * The beat leaves the way the finger was taking it and the next one arrives behind it, both
   * from where the drag left them. No beat returns to where it started: the list moves on only
   * when the neighbor has taken its place, so what was drawn is what is left.
   */
  const slide = (dir: 1 | -1, fromDx: number) => {
    const el = listEl();
    if (!el || reducedMotion() || typeof el.animate !== "function") {
      clearDrag();
      go(index + dir);
      return;
    }
    if (sliding.current) return;
    sliding.current = true;
    if (neighbor.current?.dir !== dir) {
      removeNeighbor();
      makeNeighbor(dir);
    }
    const n = neighbor.current;
    if (!n) {
      sliding.current = false;
      go(index + dir);
      return;
    }
    const gap = dir * (el.offsetWidth + SLIDE_GAP_PX);
    const own = animateTo(el, `translateX(${fromDx}px)`, `translateX(${-gap}px)`);
    animateTo(n.el, `translateX(${fromDx + gap}px)`, "translateX(0)");
    own.onfinish = () => {
      // The neighbor is exactly what the list becomes, so the swap is not seen.
      flushSync(() => go(index + dir));
      clearDrag();
      own.cancel();
      sliding.current = false;
    };
  };

  return { dragBy, springBack, slide };
}
