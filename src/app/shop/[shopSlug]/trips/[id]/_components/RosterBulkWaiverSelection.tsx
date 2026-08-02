"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import type { WaiverSendCopy } from "@/app/actions/waiver-send-types";
import { WaiverSendControl } from "@/components/today/WaiverSendControl";

/**
 * Lifts the roster's "tick a few divers, then send" selection into shared
 * client state. A plain HTML `<input form="…">` cross-association (a
 * checkbox living outside its target form, joined only by matching ids) was
 * the first approach here — it looks correct and is spec-legal, but ticking
 * one diver was observed to silently uncheck whichever other diver was
 * already ticked. Provider state sidesteps any such ambiguity entirely: each
 * checkbox is a normal controlled input, and nothing depends on same-name
 * form association.
 *
 * Rendered from `TripLayout` (../layout.tsx), not from the Guests page body,
 * deliberately: the page body sits below that page's own `<Suspense>`
 * boundary and was observed (under `cacheComponents`) getting a second,
 * fresher render up to ~1s after the first paint already looked interactive
 * — remounting anything rendered inside it and silently discarding whichever
 * checkbox had just been ticked. `TripLayout` sits above that boundary and
 * stays mounted across a same-route re-render (that's the whole point of
 * hoisting the sub-nav there — see its own docstring), so state living here
 * survives it. The trade-off: this component must reset its own selection on
 * every real navigation itself (the `usePathname()` effect below), since it
 * no longer unmounts for free between trips or when leaving Guests for
 * another tab — the same pattern ADR 20260801-cache-components-activity-state
 * uses for `InlineConfirm`/`ScheduleBuilder`.
 */
const SelectionContext = createContext<{
  selected: Set<string>;
  toggle: (bookingId: string) => void;
} | null>(null);

export function BulkWaiverSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const pathname = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is a trigger, not a value the effect body reads — any change clears the selection, which is the point.
  useEffect(() => setSelected(new Set()), [pathname]);
  const toggle = (bookingId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(bookingId)) next.delete(bookingId);
      else next.add(bookingId);
      return next;
    });
  };
  return (
    <SelectionContext.Provider value={{ selected, toggle }}>{children}</SelectionContext.Provider>
  );
}

function useSelection() {
  const ctx = useContext(SelectionContext);
  if (!ctx)
    throw new Error("BulkWaiverCheckbox/SendButton used outside BulkWaiverSelectionProvider");
  return ctx;
}

/**
 * Renders its own wrapping `<label>` (rather than trusting a caller's) so
 * the input/label association stays inside this file, where the lint rule
 * requiring it can actually see it.
 */
export function BulkWaiverCheckbox({
  bookingId,
  ariaLabel,
  labelClassName,
  className,
}: {
  bookingId: string;
  ariaLabel: string;
  labelClassName?: string;
  className?: string;
}) {
  const { selected, toggle } = useSelection();
  // Matches BookingPartyFields's pattern: false on both server and first
  // client render (no hydration mismatch), true once this checkbox's own
  // effect has run — a freshly-added diver's checkbox is a new DOM node the
  // moment it appears, so it still needs its own "is this one interactive
  // yet" signal even though the shared selection state above no longer
  // resets out from under it.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <label className={labelClassName}>
      <input
        type="checkbox"
        checked={selected.has(bookingId)}
        onChange={() => toggle(bookingId)}
        aria-label={ariaLabel}
        data-hydrated={hydrated ? "true" : "false"}
        className={className}
      />
    </label>
  );
}

export function BulkWaiverSendButton({
  shopSlug,
  tripId,
  label,
  pendingLabel,
  className,
  copy,
}: {
  shopSlug: string;
  tripId: string;
  label: string;
  pendingLabel: string;
  className: string;
  copy: WaiverSendCopy;
}) {
  const { selected } = useSelection();
  return (
    <WaiverSendControl
      shopSlug={shopSlug}
      surface="roster"
      tripId={tripId}
      bookingIds={[...selected]}
      label={label}
      pendingLabel={pendingLabel}
      className={className}
      wrapperClassName=""
      copy={copy}
    />
  );
}
