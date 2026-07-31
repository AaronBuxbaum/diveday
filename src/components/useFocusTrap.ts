"use client";

import { useEffect } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    // offsetParent is null for display:none/detached elements — cheap
    // visibility check without a full getComputedStyle pass.
    (el) => el.offsetParent !== null,
  );
}

/**
 * Focus trap + restore for a portal dialog (`CommandPalette`, `KeyboardShortcuts`
 * — both `role="dialog"`/`aria-modal="true"` overlays rendered via `createPortal`,
 * which puts them outside the DOM subtree a screen reader or Tab order would
 * otherwise associate with the trigger that opened them).
 *
 * While `active`:
 * - Moves focus into the container (its first focusable element, or the
 *   container itself if it has none) on the render where it becomes active.
 * - Keeps Tab/Shift+Tab cycling within the container instead of escaping to
 *   the page behind the backdrop.
 * - On close (or unmount), restores focus to whatever had it before the
 *   dialog opened — usually the trigger button — so a keyboard user doesn't
 *   lose their place.
 */
export function useFocusTrap(active: boolean, containerRef: React.RefObject<HTMLElement | null>) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: containerRef is a stable ref object; re-running on every render would re-steal focus.
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const first = focusableIn(container)[0];
    (first ?? container).focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || !container) return;
      const focusable = focusableIn(container);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const firstEl = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl?.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [active]);
}
