"use client";

import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { useDialogBehaviour } from "@/components/ui/useDialogBehaviour";
import { motionMs } from "@/lib/motion";

/** Where a scrim holds its panel: the middle, the foot of the screen, or the palette's upper third. */
export type LayerAnchor = "center" | "bottom" | "top";

const SCRIM_CLASS: Record<LayerAnchor, string> = {
  center: "items-center justify-center bg-foreground/25 px-4 backdrop-blur-[2px]",
  // A wash, not a curtain (issue #773): the page behind stays readable under a palette.
  top: "items-start justify-center bg-foreground/25 px-4 pt-[12vh] backdrop-blur-[2px]",
  bottom: "items-end bg-foreground/30 backdrop-blur-sm",
};

/**
 * **The scrim every dismissible layer draws**: the one `fixed inset-0 z-50` spelling, its
 * entrance and exit, and click-away that closes only when the scrim itself is hit. `Dialog`
 * is the centred face; the manifest's `PersonSheet` anchors to the `bottom`, the command
 * palette to the `top`. The caller still portals it, and still spreads `useDialogBehaviour`
 * on its own panel.
 */
export function LayerScrim({
  anchor,
  closing,
  onDismiss,
  children,
}: {
  anchor: LayerAnchor;
  closing: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  return (
    // Click-away backdrop; Escape and an explicit control also close it.
    // biome-ignore lint/a11y/noStaticElementInteractions: presentational backdrop
    <div
      className={`fixed inset-0 z-50 flex ${SCRIM_CLASS[anchor]} ${closing ? "animate-fade-out" : "animate-fade-in"}`}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      {children}
    </div>
  );
}

/** **The lock face**: full-bleed, opaque, no dismissal — the session-ended screen is the one user. */
export const LAYER_LOCK_CLASS = "fixed inset-0 z-50 grid place-items-center bg-surface p-6";

/**
 * **`layer.tsx` is where an overlay is drawn.** `Dialog` is the centred face; the
 * scrim spelling (`fixed inset-0 z-50`) lives only here, and
 * `stacking-layers.test.ts` refuses it elsewhere, with (issue #2766).
 *
 * A small centered dialog for collecting input — distinct from `InlineConfirm`,
 * which principle 7 reserves for a genuinely irreversible action or a send.
 * This is for the shape neither of those cover: a short form that needs its
 * own focused space off the page flow (docs/design/principles.md).
 *
 * Portalled to `document.body` (same reason as `CommandPalette`'s: a header
 * or card ancestor with its own `backdrop-blur`/`transform` would otherwise
 * become the containing block for `position: fixed`, clipping the backdrop to
 * that ancestor's box instead of the viewport). Reuses the entrance/exit
 * timing, focus trap and Escape `CommandPalette` uses (`useDialogBehaviour`) rather
 * than inventing a second.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { mounted, closing, dialogProps } = useDialogBehaviour({
    open,
    onClose,
    containerRef: dialogRef,
    exitMs: motionMs("base"),
  });

  if (!mounted) return null;

  return createPortal(
    <LayerScrim anchor="center" closing={closing} onDismiss={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        {...dialogProps}
        aria-labelledby={titleId}
        // Never taller than the screen: a fixed layer does not scroll with the
        // page, so the "Add a unit" form on a phone ran past the bottom edge
        // with its submit cut in half and nothing to scroll. The title stays;
        // the body scrolls inside the dialog.
        className={`flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col rounded-panel border border-border bg-surface shadow-2xl outline-none ${closing ? "animate-scale-out" : "animate-scale-in"} ${className}`}
      >
        <h2 id={titleId} className={`${SECTION_TITLE_CLASS} shrink-0 px-5 pt-5 sm:px-6 sm:pt-6`}>
          {title}
        </h2>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pt-4 pb-5 sm:px-6 sm:pb-6">
          {children}
        </div>
      </div>
    </LayerScrim>,
    document.body,
  );
}
