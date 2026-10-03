// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { MENU_PANEL } from "@/components/ui/menu";
import { useMenuDismissal } from "@/components/useMenuDismissal";

/**
 * **A row's "⋯": one glyph that opens a short list of acts beside itself.**
 *
 * The schedule board's row menu (`WeekBoard`'s `RowActions`) set the
 * behaviour, and every row menu in the app now shares it:
 *
 * - the list opens directly under its button, end-aligned, as a floating
 *   panel over the rows below — it never pushes the row taller or reflows
 *   what sits beside it;
 * - a second tap on the "⋯" closes it, as does Escape (focus goes back to the
 *   "⋯") or a tap anywhere else (`useMenuDismissal`);
 * - the button stays lit while its list is open, so the reader can see which
 *   row the list belongs to.
 *
 * The Reviews "⋯" used to be a `<details>` whose list opened *inside* the row:
 * the row grew, the review text and Publish slid down, the "⋯" lost its fill
 * the moment it opened, and a second `<details>` nested in it for Hide
 * stretched the row again. That is the bug this replaces.
 *
 * The panel's content is the caller's — rows built with `menuRowClass(…,
 * { gutter: false })`, or a small form. A function child receives `close`, so
 * an act inside can shut the list it was chosen from.
 */
export function RowMenu({
  label,
  panelClassName = "w-48",
  onClosed,
  children,
}: {
  /** The "⋯" button's accessible name, naming the row it belongs to. */
  label: string;
  /** The panel's width; a list of acts is `w-48`, a form inside it wider. */
  panelClassName?: string;
  /** Called whenever the list shuts, however it shut — to reset a panel's view. */
  onClosed?: () => void;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const close = useCallback(() => {
    setOpen(false);
    onClosedRef.current?.();
  }, []);
  useMenuDismissal({ open, close, inside: [rootRef], returnFocus: triggerRef });
  const panelRef = useRef<HTMLDivElement>(null);

  // The first act takes focus as the list opens, so a keyboard reader lands in
  // the list they opened, and Escape hands it back to the "⋯".
  useEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector<HTMLElement>("button, a, select, input, textarea")
      ?.focus({ preventScroll: true });
  }, [open]);

  return (
    // The trigger and the panel share one root, so a tap on the "⋯" counts as
    // inside and only its own click toggles. `data-row-menu-open` lets the
    // row's slot lift itself over the rows below while the list is out
    // (`LedgerRow`'s trailing slot).
    <div
      ref={rootRef}
      data-row-menu-open={open ? "" : undefined}
      className={`relative ${open ? "z-30" : ""}`.trim()}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className={buttonClass({
          variant: "ghost",
          size: "icon-sm",
          className: "aria-expanded:bg-surface-sunken",
        })}
      >
        <DiveDayIcon name="more" className="size-4" />
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          data-row-menu=""
          className={`absolute end-0 top-full z-30 mt-1 max-w-[calc(100vw-2rem)] animate-scale-in ${MENU_PANEL} ${panelClassName}`}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}
