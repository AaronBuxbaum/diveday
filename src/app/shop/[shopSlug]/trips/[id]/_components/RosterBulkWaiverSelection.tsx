"use client";

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
 */
const SelectionContext = createContext<{
  selected: Set<string>;
  toggle: (bookingId: string) => void;
  /** Null until mounted (matches server output, avoiding a hydration
   * mismatch); a fresh random id after that, set only from an effect so it
   * never re-runs mid-lifetime. Exposed on the checkboxes below as
   * `data-mount-id` — the same `data-hydrated`-style signal
   * BookingPartyFields uses, but identifying *which* mount, not just
   * whether one happened. This route's dynamic content was observed (under
   * `cacheComponents`) getting a second, fresher render up to ~1s after the
   * first paint already looked interactive, discarding this provider's
   * `selected` set along with it — a different failure mode than the
   * un-keyed-state-*surviving* class ADR 20260801-cache-components-activity-state
   * audited, so treat this as a separate, still-open observation rather than
   * that ADR's fix pattern applying here. e2e polls this id until it stops
   * changing rather than trusting the first mount to be the last one. */
  mountId: string | null;
} | null>(null);

export function BulkWaiverSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mountId, setMountId] = useState<string | null>(null);
  useEffect(() => setMountId(Math.random().toString(36).slice(2)), []);
  const toggle = (bookingId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(bookingId)) next.delete(bookingId);
      else next.add(bookingId);
      return next;
    });
  };
  return (
    <SelectionContext.Provider value={{ selected, toggle, mountId }}>
      {children}
    </SelectionContext.Provider>
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
  const { selected, toggle, mountId } = useSelection();
  return (
    <label className={labelClassName}>
      <input
        type="checkbox"
        checked={selected.has(bookingId)}
        onChange={() => toggle(bookingId)}
        aria-label={ariaLabel}
        data-hydrated={mountId ? "true" : "false"}
        data-mount-id={mountId ?? ""}
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
