// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { MoreMenu } from "@/components/MoreMenu";
import { buttonClass } from "@/components/ui/button";
import { menuRowClass } from "@/components/ui/menu";

/**
 * **An opened guest's rare acts: one menu, one sheet** (owner, 2026-11-25:
 * the panel was "really busy and ugly"). More is a real menu beside Close.
 * A row that needs a question answered (move, not here, turn away, cancel)
 * opens its sheet at the top of the panel; choosing another closes the first.
 */
type GuestActions = { active: string | null; show: (action: string | null) => void };
const GuestActionsContext = createContext<GuestActions>({ active: null, show: () => {} });

export function GuestActionsProvider({
  initial = null,
  openOnHash,
  children,
}: {
  /** The sheet a refused action comes back to. */
  initial?: string | null;
  /** A link that lands on one of these fragments opens that sheet. */
  openOnHash?: Readonly<Record<string, string>>;
  children: ReactNode;
}) {
  const [active, setActive] = useState<string | null>(initial);
  useEffect(() => {
    const landed = openOnHash?.[window.location.hash.slice(1)];
    if (landed) setActive(landed);
  }, [openOnHash]);
  const value = useMemo(() => ({ active, show: setActive }), [active]);
  return <GuestActionsContext.Provider value={value}>{children}</GuestActionsContext.Provider>;
}

/**
 * The guest's More, drawn in the row's header beside Close (the slot
 * `GuestFixList` leaves for it), so the menu keeps this panel's state.
 */
export function GuestMoreMenu({
  bookingId,
  label,
  children,
}: {
  bookingId: string;
  label: string;
  children: ReactNode;
}) {
  // Undefined until looked for; null where the row leaves no slot, and the menu stands in the panel.
  const [slot, setSlot] = useState<Element | null | undefined>(undefined);
  useEffect(() => {
    setSlot(document.querySelector(`[data-guest-menu-slot="${bookingId}"]`));
  }, [bookingId]);
  if (slot === undefined) return null;
  const menu = (
    <span data-guest-more={bookingId}>
      <MoreMenu label={label} size="sm">
        {children}
      </MoreMenu>
    </span>
  );
  return slot ? createPortal(menu, slot) : menu;
}

/** A menu row that opens its sheet in the panel. */
export function GuestMenuAction({
  action,
  tone = "quiet",
  children,
}: {
  action: string;
  tone?: "quiet" | "danger";
  children: ReactNode;
}) {
  const { active, show } = useContext(GuestActionsContext);
  return (
    <button
      type="button"
      data-menu-close=""
      data-guest-action={action}
      aria-expanded={active === action}
      onClick={() => show(active === action ? null : action)}
      className={menuRowClass(tone, { gutter: false })}
    >
      {children}
    </button>
  );
}

/** The question a menu row asks, at the top of the panel. Kept mounted, so a typed answer survives. */
export function GuestActionSheet({
  id,
  action,
  children,
}: {
  /** The fragment a link elsewhere lands on. */
  id?: string;
  action: string;
  children: ReactNode;
}) {
  const { active } = useContext(GuestActionsContext);
  const sheet = useRef<HTMLDivElement>(null);
  const open = active === action;
  useEffect(() => {
    if (!open) return;
    sheet.current?.scrollIntoView({ block: "nearest" });
    sheet.current
      ?.querySelector<HTMLElement>("select, input:not([type=hidden]), button")
      ?.focus({ preventScroll: true });
  }, [open]);
  return (
    <div
      ref={sheet}
      id={id}
      data-guest-sheet={action}
      hidden={!open}
      className="scroll-mt-24 rounded-lg bg-surface-sunken p-3"
    >
      {children}
    </div>
  );
}

/** "Never mind": closes the open sheet. */
export function GuestActionDismiss({ children }: { children: ReactNode }) {
  const { show } = useContext(GuestActionsContext);
  return (
    <button
      type="button"
      onClick={() => show(null)}
      className={buttonClass({ variant: "ghost", size: "sm" })}
    >
      {children}
    </button>
  );
}
