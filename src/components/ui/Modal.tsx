"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useExitAnimation } from "@/components/useExitAnimation";
import { useFocusTrap } from "@/components/useFocusTrap";

/**
 * A small centered dialog for collecting input — distinct from `InlineConfirm`,
 * which principle 7 reserves for a genuinely irreversible action or a send.
 * This is for the shape neither of those cover: a short form that needs its
 * own focused space off the page flow (docs/design/principles.md).
 *
 * Portalled to `document.body` (same reason as `CommandPalette`'s: a header
 * or card ancestor with its own `backdrop-blur`/`transform` would otherwise
 * become the containing block for `position: fixed`, clipping the backdrop to
 * that ancestor's box instead of the viewport). Reuses the entrance/exit
 * timing and focus-trap primitives already used by `CommandPalette` and
 * `WaterLocker` rather than inventing a third.
 */
export function Modal({
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
  const { mounted, closing } = useExitAnimation(open, 180);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(open, dialogRef);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    // Click-away backdrop; Escape and an explicit control also close it.
    // biome-ignore lint/a11y/noStaticElementInteractions: presentational backdrop
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 px-4 backdrop-blur-[2px] ${closing ? "animate-fade-out" : "animate-fade-in"}`}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl outline-none sm:p-6 ${closing ? "animate-scale-out" : "animate-scale-in"} ${className}`}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
