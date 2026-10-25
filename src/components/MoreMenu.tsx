// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { MENU_PANEL, menuRowClass } from "@/components/ui/menu";
import { useMenuDismissal } from "@/components/useMenuDismissal";

/**
 * **A header's rare acts behind one named button: "More", "Export".**
 *
 * `RowMenu` is a row's "⋯"; this is the same floating panel under a button
 * that says what it holds, for a page header whose secondary doors would
 * otherwise sit at the primary's weight or wrap alone on a phone (visual
 * review 2026-10-24: A06's three downloads, A16's Refresh, Void and Print,
 * A17's schedule doors at 390). The rows are the caller's, built with
 * `menuRowClass(…, { gutter: false })`: links, small forms, `MoreMenuPrint`.
 *
 * It closes on a second tap, Escape (focus back to the trigger), a tap
 * outside, or any navigation (`useMenuDismissal`). The first row takes focus
 * as it opens.
 */
export function MoreMenu({
  label,
  panelClassName = "w-56",
  className = "",
  size = "md",
  children,
}: {
  /** The trigger's visible name, already translated. */
  label: string;
  panelClassName?: string;
  /** The root's own placement, such as `md:hidden`. */
  className?: string;
  size?: "sm" | "md";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);
  useMenuDismissal({ open, close, inside: [rootRef], returnFocus: triggerRef });

  useEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector<HTMLElement>("button, a, select, input, textarea")
      ?.focus({ preventScroll: true });
  }, [open]);

  return (
    <div
      ref={rootRef}
      data-more-menu=""
      className={`relative print:hidden ${open ? "z-20" : ""} ${className}`.trim()}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((was) => !was)}
        className={buttonClass({ variant: "secondary", size, className: "gap-2" })}
      >
        {label}
        <DisclosureCaret direction="down" className={open ? "rotate-180" : ""} />
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          data-more-menu-panel=""
          className={`absolute end-0 top-full z-20 mt-1 max-w-[calc(100vw-2rem)] animate-scale-in ${MENU_PANEL} ${panelClassName}`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** A menu row that opens the browser's print dialog. */
export function MoreMenuPrint({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={menuRowClass("quiet", { gutter: false })}
    >
      {label}
    </button>
  );
}
