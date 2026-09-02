"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { groupLabelClass } from "@/components/ui/ledger";

/**
 * The manifest-local rare-doors menu (ADR
 * 20260827-the-departure-is-two-working-surfaces, decision 2).
 *
 * This is intentionally separate from the shop-wide More navigation and from
 * the phone dock. The manifest's emergency reference is a page-local,
 * read-only fact: useful occasionally, never the first thing a wet thumb sees.
 */
export function ManifestMoreMenu({
  label,
  closeLabel,
  children,
  variant,
}: {
  label: string;
  closeLabel: string;
  children: React.ReactNode;
  variant: "header" | "footer";
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (triggerRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) {
        return;
      }
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  if (variant === "header") {
    return (
      <div className="relative print:hidden lg:hidden">
        <button
          ref={triggerRef}
          type="button"
          aria-label={label}
          aria-expanded={open}
          aria-controls={panelId}
          className="grid size-11 place-items-center rounded-full border border-border bg-surface text-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
          onClick={() => setOpen((current) => !current)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <circle cx="5" cy="12" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
          </svg>
        </button>
        {open ? (
          <div
            ref={panelRef}
            id={panelId}
            className="absolute end-0 top-full z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-panel border border-border bg-surface p-3 shadow-xl"
          >
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
              <p className={groupLabelClass()}>{label}</p>
              <button
                type="button"
                aria-label={closeLabel}
                className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-sunken hover:text-foreground"
                onClick={close}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <path d="m5 5 10 10M15 5 5 15" />
                </svg>
              </button>
            </div>
            {children}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="hidden print:hidden lg:block">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
        onClick={() => setOpen((current) => !current)}
      >
        {label}
        <DisclosureCaret className={open ? "rotate-90" : ""} />
      </button>
      {open ? (
        <div ref={panelRef} id={panelId} className="mt-2 max-w-2xl">
          {children}
        </div>
      ) : null}
    </div>
  );
}
