"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LEAD_TITLE_CLASS } from "@/components/ui/typography";
import { useDragSheet } from "@/components/useDragSheet";
import { useExitAnimation } from "@/components/useExitAnimation";
import { useFocusTrap } from "@/components/useFocusTrap";
import { motionMs } from "@/lib/motion";

const SHEET_DURATION_MS = motionMs("base");

/**
 * **A diver, over the day.**
 *
 * Tide files everything under an hour, and a diver with no booking has none
 * (ADR 20260919-one-idea, decision I · Tide — "a diver with no hour has no
 * hour; the search finds them, and their record opens as a sheet over the
 * day"). So the search does not navigate away from the day to answer a
 * question about a person; it lays them over it, and closing puts the staffer
 * back exactly where they were looking.
 *
 * **It is a reading, not the record.** Every act on a diver lives on their own
 * page, and the one door at the foot of this sheet goes there. That is not
 * timidity about scope: the record's twelve forms all end in a redirect
 * carrying a `?notice=`, and a redirect tears an overlay off the screen — so a
 * sheet that offered them would work exactly once, on the way out. `/manifest`'s
 * `PersonSheet` made the same call for the same reason and has held.
 *
 * **Opening is a history entry, closing is not a navigation.** The server
 * renders this whenever `?diver=` is on the day, and the client owns leaving:
 * the exit plays, the sheet unmounts, and the param is dropped with
 * `history.replaceState` — the same one-shot idiom `FlashParams` uses, for the
 * same reason. A refresh must not reopen a sheet the reader has closed.
 *
 * The thumb closes it, which is the phone answer: `useDragSheet` carries this
 * app's one written gesture contract (resistance, a cancel curve, velocity,
 * and no fight with a scroll) and had no consumer left after slice 23b
 * deleted the dock it was built for.
 */
export function DiverSheet({
  name,
  subtitle,
  closeLabel,
  children,
}: {
  name: string;
  /** Contact and visit count — what the search was for, under the name. */
  subtitle: string;
  closeLabel: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  /**
   * **The portal waits for a document.** `PersonSheet` never meets this: its
   * `open` starts `false` and a click sets it, so its first render — the one
   * the server does — reaches no `createPortal`. Here the *server* decides the
   * sheet is open, because `?diver=` is on the URL, so the first render is the
   * SSR pass, where `document` does not exist and `createPortal` throws. A
   * hard navigation to `?diver=` answered 500 on exactly that, while every
   * click-through from the palette stayed green, because a client transition
   * never runs this on a server. The visual capture is what found it: it is
   * the one test that loads the URL cold.
   *
   * Holding the *target* rather than a `hydrated` boolean keeps the condition
   * honest — what is missing during SSR is a node to portal into, and that is
   * what the render below waits for.
   */
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const { mounted, closing } = useExitAnimation(open, SHEET_DURATION_MS);

  useFocusTrap(open, sheetRef);

  useEffect(() => setPortalTarget(document.body), []);

  const close = useCallback(() => setOpen(false), []);
  const drag = useDragSheet({ onDismiss: close, disabled: closing });

  // The param goes once the sheet is gone rather than when the reader asks for
  // it: dropping it first would re-render the day without the sheet and take
  // the exit animation with it.
  useEffect(() => {
    if (mounted) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("diver")) return;
    url.searchParams.delete("diver");
    window.history.replaceState(null, "", url);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mounted]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close, open]);

  if (!mounted || !portalTarget) return null;

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop is a presentational click-away surface
    <div
      className={`fixed inset-0 z-50 flex items-end bg-foreground/30 backdrop-blur-sm print:hidden ${
        drag.dragging ? "" : closing ? "animate-fade-out" : "animate-fade-in"
      }`}
      // The scrim tracks the finger one pixel per pixel while a drag is live,
      // so the day behind it comes back as the sheet leaves rather than after.
      style={drag.dragging ? { opacity: drag.scrim } : undefined}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      {/* Geometry, radius, shadow and safe-area padding are the manifest
          sheet's own, unchanged: two sheets one tap apart that rounded their
          corners differently is precisely the drift `SectionCard` has no
          `radius` prop to prevent. */}
      <section
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        {...drag.handlers}
        style={drag.style}
        className={`max-h-[min(90dvh,48rem)] w-full overflow-y-auto overscroll-contain rounded-t-[22px] border-border border-t bg-surface px-5 pt-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl outline-none sm:mx-auto sm:max-w-2xl sm:px-7 ${
          drag.dragging ? "" : closing ? "sheet-out" : "rise-in"
        }`}
      >
        {/* The handle is the drag surface once the body can scroll, so a
            finger that means to read the story reads the story. */}
        <div aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-border-strong" />
        <header className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className={LEAD_TITLE_CLASS}>
              {name}
            </h2>
            <p id={descriptionId} className="mt-1 text-muted text-sm">
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={close}
            className="grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
              className="size-5"
            >
              <path d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        </header>
        <div className="mt-4">{children}</div>
      </section>
    </div>,
    portalTarget,
  );
}
