"use client";

import { createContext, useContext, useState } from "react";
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
} | null>(null);

export function BulkWaiverSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
  return (
    <label className={labelClassName}>
      <input
        type="checkbox"
        checked={selected.has(bookingId)}
        onChange={() => toggle(bookingId)}
        aria-label={ariaLabel}
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
