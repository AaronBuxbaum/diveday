"use client";

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
  hint,
  className = "",
  children,
}: {
  ariaLabel: string;
  /** The state/affordance slot at the row's end — words plus a shape, never color alone. */
  trailing: React.ReactNode;
  /** What the trailing slot says while the tap is in flight. */
  pendingTrailing: React.ReactNode;
  /** Optional quiet line under the trailing slot (the re-tap undo hint). */
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-label={ariaLabel}
      disabled={pending}
      className={`flex min-h-14 w-full touch-manipulation items-center justify-between gap-4 px-4 py-3 text-left transition-[background-color,transform] duration-200 active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 sm:px-5 ${className}`}
    >
      <span className="min-w-0">{children}</span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span aria-hidden="true">{pending ? pendingTrailing : trailing}</span>
        {hint}
      </span>
    </button>
  );
}
