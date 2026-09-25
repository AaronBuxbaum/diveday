"use client";

import { Children } from "react";
import { useFormStatus } from "react-dom";

/**
 * The queue's one-tap row: the whole line is the submit target, the same
 * grammar the manifest's roll call and the Today queue already speak — one
 * line per person, one tap, with the state spelled out in the trailing slot
 * rather than a column of identical primary buttons (design principles 8 and
 * 10). A row this size is also the best dock-test target the counter can
 * offer: the person tapping is often holding the diver's C-card in the other
 * hand.
 *
 * Client-side only for `useFormStatus`: on a slow counter connection the tap
 * must visibly take — the trailing label swaps to its pending form and the row
 * refuses a second submit until the first lands.
 */
export function QueueRowButton({
  ariaLabel,
  trailing,
  pendingTrailing,
  className = "",
  children,
}: {
  ariaLabel: string;
  /** The state/affordance slot at the row's end — words plus a shape, never color alone. */
  trailing: React.ReactNode;
  /** What the trailing slot says while the tap is in flight. */
  pendingTrailing: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  // **No slot when there is nothing in it.** The checked-in row's undo trails
  // nothing at rest (its group already says "Checked in"), and the slot's
  // `span` rendered anyway: empty, it still took the row's 16px gap, so the
  // pixel probe found the diver's details wrapping 16px short of the row's
  // end on every checked-in row. `Children.toArray` drops `null`, `undefined`
  // and booleans — the same question `FormStatus` asks of its children.
  const slot = pending ? pendingTrailing : trailing;
  return (
    <button
      type="submit"
      aria-label={ariaLabel}
      disabled={pending}
      // Rule to rule, words on the column: the form around this takes back the
      // room `LedgerRow` keeps (`-mx-2`, in `CheckInActionForm`) and the room
      // goes on here as padding, so the fill spans the row's hairlines the way
      // a door's does and the name starts where the group labels and the
      // walk-in door start.
      className={`flex min-h-14 w-full touch-manipulation items-center justify-between gap-4 px-2 py-3 text-left transition-[background-color,transform] active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 ${className}`}
    >
      <span className="min-w-0">{children}</span>
      {Children.toArray(slot).length > 0 ? (
        <span aria-hidden="true" className="shrink-0">
          {slot}
        </span>
      ) : null}
    </button>
  );
}
