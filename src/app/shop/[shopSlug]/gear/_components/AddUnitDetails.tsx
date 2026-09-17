"use client";

import { useEffect, useRef, useState } from "react";

/** The event `AddUnitLink` fires; owning both ends in one file keeps the
 * name from drifting between them. */
const OPEN_EVENT = "gear:open-add-unit";

/**
 * The "Add a unit" disclosure and the register's one door onto the add form,
 * open state owned by React rather than by a DOM mutation a later render could
 * silently undo. `AddUnitLink` (the empty register's own door) can only ever
 * *ask* this to open, via a `window` event — it has no reference to this
 * component and doesn't need one.
 *
 * **`data-hydrated` once React owns it.** The summary is a native control, so
 * a tap always toggles the element; what arrives late is React's idea of
 * `open`, and the first render after that would otherwise overwrite whatever
 * the browser had already done. The effect below adopts the DOM's state before
 * publishing the flag, so an early tap survives rather than being undone one
 * frame later — and `e2e/gear.spec.ts` waits on the flag, the same way it
 * waited on `AddUnitLink`'s when the header carried a second door (issue 1446).
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
  const details = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(initialOpen);
  const [hydrated, setHydrated] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount only — `open` is read once, as the thing to compare the DOM against.
  useEffect(() => {
    // Whatever the native control did before this ran is the truth; taking it
    // first is what keeps the state sync from *closing* an early tap.
    if (details.current && details.current.open !== open) setOpen(details.current.open);
    setHydrated(true);
    const openIt = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, openIt);
    return () => window.removeEventListener(OPEN_EVENT, openIt);
  }, []);

  return (
    <details
      ref={details}
      open={open}
      data-hydrated={hydrated ? "true" : undefined}
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
