// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { createContext, type ReactNode, useContext, useId, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";

/**
 * **A message row opens in place** (visual review A15). Each row ends on one
 * control, the chevron, and what the "⋯" used to float (Open the record,
 * Move, Mark running late, Mark done, Delete) sits in the row's open view
 * under the message.
 *
 * The provider renders no box: the row (`LedgerRow`) stays the list item, and
 * the toggle and the open view are both inside it.
 */
const RowOpen = createContext<{ open: boolean; toggle: () => void; viewId: string } | null>(null);

export function InboxRowOpen({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const viewId = useId();
  return (
    <RowOpen.Provider value={{ open, toggle: () => setOpen((was) => !was), viewId }}>
      {children}
    </RowOpen.Provider>
  );
}

export function InboxRowToggle({ label }: { label: string }) {
  const row = useContext(RowOpen);
  if (!row) return null;
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={row.open}
      aria-controls={row.viewId}
      onClick={row.toggle}
      className={buttonClass({ variant: "ghost", size: "icon-sm" })}
    >
      <DisclosureCaret direction="down" className={row.open ? "rotate-180" : ""} />
    </button>
  );
}

export function InboxRowView({ children }: { children: ReactNode }) {
  const row = useContext(RowOpen);
  if (!row) return null;
  return (
    <div
      id={row.viewId}
      hidden={!row.open}
      data-inbox-open-view=""
      className="relative z-10 mt-3 flex flex-wrap items-center gap-2"
    >
      {children}
    </div>
  );
}
