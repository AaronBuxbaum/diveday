"use client";

import { useEffect, useState } from "react";

/** The event `AddUnitLink` fires; owning both ends in one file keeps the
 * name from drifting between them. */
const OPEN_EVENT = "gear:open-add-unit";

/**
 * The "Add a unit" disclosure, open state owned by React rather than by a
 * DOM mutation a later render could silently undo. `AddUnitLink` (the two
 * "+ Add gear" doors elsewhere on the page) can only ever *ask* this to open,
 * via a `window` event — it has no reference to this component and doesn't
 * need one.
 */
export function AddUnitDetails({
  initialOpen,
  className,
  children,
}: {
  /** Server-decided: a refusal from this form to show. */
  initialOpen: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);

  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, openIt);
    return () => window.removeEventListener(OPEN_EVENT, openIt);
  }, []);

  return (
    <details
      open={open}
      // A person collapsing it by hand still has to stay in sync with
      // React's own idea of `open`, or the next unrelated re-render would
      // snap it back open.
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className={className}
    >
      {children}
    </details>
  );
}

export function openAddUnitDetails() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}
