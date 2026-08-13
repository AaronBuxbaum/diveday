"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * The one dismissal contract every disclosed staff menu shares — the header's
 * More menu, the phone dock's More sheet, and the identity menu each used to
 * carry a verbatim copy of this machinery, and three copies of subtle
 * event-listener logic drift the moment one learns something (a touch fix, a
 * focus rule) the others don't.
 *
 * While `open`:
 * - a pointerdown anywhere outside every ref in `inside` closes the menu — a
 *   stray tap simply dismisses, and a tap on another control both closes
 *   (pointerdown) and acts (click), so no second tap is ever owed;
 * - Escape closes and hands focus back to `returnFocus`, matching every other
 *   dismissible menu.
 *
 * Always: any (re)navigation closes, so an Activity-preserved re-show can
 * never resurface an open menu over the new page. The first run is skipped —
 * mounting on the page that disclosed you is not a navigation.
 *
 * Listeners exist only while open. `close` must be referentially stable (a
 * `useState` setter call wrapped in `useCallback`, or the setter itself),
 * because the effects list it as a dependency.
 */
export function useMenuDismissal({
  open,
  close,
  inside,
  returnFocus,
}: {
  open: boolean;
  close: () => void;
  /** Everything a pointerdown may land on without dismissing. */
  inside: readonly React.RefObject<HTMLElement | null>[];
  /** Where Escape sends focus — the disclosure's own trigger. */
  returnFocus: React.RefObject<HTMLElement | null>;
}) {
  // A ref rather than a dependency: the `inside` array is rebuilt every
  // render, and re-subscribing listeners on each render defeats the
  // exists-only-while-open contract.
  const insideRef = useRef(inside);
  insideRef.current = inside;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      for (const ref of insideRef.current) {
        if (ref.current?.contains(event.target)) return;
      }
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      returnFocus.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close, returnFocus]);

  const pathname = usePathname();
  const pathnameEffectRan = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is a trigger, not a value the effect body reads — any change closes the menu, which is the point.
  useEffect(() => {
    if (!pathnameEffectRan.current) {
      pathnameEffectRan.current = true;
      return;
    }
    close();
  }, [pathname]);
}
