// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
 * - when the list would run under the foot of the screen (or the phone tab
 *   bar), it opens upward from the "⋯" instead;
 * - a second tap on the "⋯" closes it, as does Escape (focus goes back to the
 *   "⋯") or a tap anywhere else (`useMenuDismissal`).
 *
 * The Reviews "⋯" used to be a `<details>` whose list opened *inside* the row:
 * the row grew, the review text and Publish slid down, and a second `<details>` nested in it for Hide
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
  const [upward, setUpward] = useState(false);

  // Measured before paint, so a list near the foot never flashes downward
  // first. The tab bar is fixed over the foot below `lg` (`--tabbar-h`), and a
  // list that opened under it would hide its last act — Delete, on the Inbox.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the panel's content can change its height
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) {
      setUpward(false);
      return;
    }
    const trigger = triggerRef.current?.getBoundingClientRect();
    const height = panel.getBoundingClientRect().height;
    if (!trigger || height === 0) return;
    const floor = window.innerHeight - tabBarHeight(panel);
    setUpward(trigger.bottom + height + 8 > floor && trigger.top - height - 8 >= 0);
  }, [open, children]);

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
      className={`relative ${open ? "z-20" : ""}`.trim()}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className={buttonClass({ variant: "ghost", size: "icon-sm" })}
      >
        <DiveDayIcon name="more" className="size-4" />
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          data-row-menu=""
          className={`absolute end-0 z-20 ${upward ? "bottom-full mb-1" : "top-full mt-1"} max-w-[calc(100vw-2rem)] animate-scale-in ${MENU_PANEL} ${panelClassName}`}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}

/** The phone tab bar's height in px, read off `--tabbar-h` (`0px` from `lg` up). */
function tabBarHeight(element: HTMLElement): number {
  const raw = getComputedStyle(element).getPropertyValue("--tabbar-h").trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return 0;
  if (raw.endsWith("rem")) {
    return value * Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  }
  return value;
}
