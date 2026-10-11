"use client";

import { useEffect, useRef } from "react";
import { useExitAnimation } from "@/components/useExitAnimation";
import { useFocusTrap } from "@/components/useFocusTrap";

/**
 * What every modal layer's panel carries beside its literal `role="dialog"`; spread them, never
 * spell them. The role stays written at the call site because Biome's ARIA rules read it there
 * to check the panel's `aria-label`/`aria-labelledby`.
 */
export const DIALOG_PANEL_PROPS = {
  "aria-modal": "true",
  tabIndex: -1,
} as const;

/**
 * **One keyboard contract for every modal layer**: holds focus inside while open and hands it
 * back on close (`useFocusTrap`, or the `triggerRef` when one is given), closes on Escape, keeps
 * mounted through its exit animation, and — for a sheet that covers the page — stops the page
 * behind it scrolling. The panel's `aria-modal` and `tabIndex` come back as `dialogProps`, so
 * no layer spells them by hand.
 *
 * `Modal`, the manifest's `PersonSheet` and the command palette each carried their own copy of
 * this; `PersonSheet` additionally sent focus back to its trigger by hand on Escape. One hook is
 * what keeps a fourth from forgetting `preventDefault`, the scroll lock or `aria-modal`.
 *
 * `triggerRef` is for a layer whose opener is a known control (the manifest's name button):
 * whichever way the layer closes — Escape, the scrim, its own close control — focus lands on that
 * control rather than on whatever happened to hold focus when it opened.
 *
 * `onClose` is read through a ref, so a caller passing a fresh closure every render does not
 * re-subscribe the listener on every render.
 */
export function useDialogBehaviour({
  open,
  onClose,
  containerRef,
  triggerRef,
  exitMs,
  lockScroll = false,
}: {
  open: boolean;
  onClose: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
  /** The control that opened the layer; focus returns to it on every close. */
  triggerRef?: React.RefObject<HTMLElement | null>;
  /** How long the exit animation runs; the layer stays mounted for it. */
  exitMs: number;
  /** Stop the page behind scrolling while the layer is on screen. */
  lockScroll?: boolean;
}): { mounted: boolean; closing: boolean; dialogProps: typeof DIALOG_PANEL_PROPS } {
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

  // Declared after `useFocusTrap`, so on close its cleanup (restoring the previously focused
  // element) runs first and the trigger wins.
  // biome-ignore lint/correctness/useExhaustiveDependencies: triggerRef is a stable ref object.
  useEffect(() => {
    if (!open || !triggerRef) return;
    return () => triggerRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!lockScroll || !mounted) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [lockScroll, mounted]);

  return { mounted, closing, dialogProps: DIALOG_PANEL_PROPS };
}
