"use client";

import { useEffect, useRef } from "react";
import { useExitAnimation } from "@/components/useExitAnimation";
import { useFocusTrap } from "@/components/useFocusTrap";

/**
 * **What every modal layer here does the same way**: holds focus inside while
 * open and hands it back on close (`useFocusTrap`), closes on Escape, keeps
 * mounted through its exit animation, and — for a sheet that covers the page —
 * stops the page behind it scrolling.
 *
 * `Modal`, the manifest's `PersonSheet` and the command palette each carried
 * their own copy of the Escape listener beside the same two hooks; one copy is
 * what keeps a fourth from forgetting `preventDefault` or the scroll lock.
 *
 * `onClose` is read through a ref, so a caller passing a fresh closure every
 * render does not re-subscribe the listener on every render.
 */
export function useDialog({
  open,
  onClose,
  containerRef,
  exitMs,
  lockScroll = false,
}: {
  open: boolean;
  onClose: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
  /** How long the exit animation runs; the layer stays mounted for it. */
  exitMs: number;
  /** Stop the page behind scrolling while the layer is on screen. */
  lockScroll?: boolean;
}): { mounted: boolean; closing: boolean } {
  useFocusTrap(open, containerRef);
  const { mounted, closing } = useExitAnimation(open, exitMs);

  const latestOnClose = useRef(onClose);
  useEffect(() => {
    latestOnClose.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      latestOnClose.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!lockScroll || !mounted) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [lockScroll, mounted]);

  return { mounted, closing };
}
