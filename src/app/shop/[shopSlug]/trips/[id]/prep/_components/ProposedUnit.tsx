"use client";

import { type ReactNode, useEffect, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import type { ConfirmProposalsResult } from "../proposal-actions";

export interface ProposedUnitCopy {
  /**
   * "Proposed: BCD #4 · L", said as a proposal so it never reads as held; or,
   * on a piece with no proposal, "No unit yet".
   */
  line: string;
  /** "Change", or "Pick" where nothing is proposed. */
  reveal: string;
}

/**
 * **One piece, one line, one text button** (visual review 2026-10-24, A10).
 *
 * The row says which unit DiveDay would hand over and offers one quiet act:
 * Change reveals the row's own
 * picker inline (`children`, its `RentalUnitPicker`), where choosing a unit is
 * the assignment. Nothing is held by the proposal: "Assign all" at the top
 * confirms every proposal at once, and the exclusion constraint is still the
 * only thing that can say a unit is free. The per-row Assign is gone; a
 * proposal confirmed alone is a Change and a pick of that unit.
 */
export function ProposedUnit({
  copy,
  proposed = true,
  children,
}: {
  copy: ProposedUnitCopy;
  /**
   * False on a piece DiveDay has no unit to propose for: the same line and
   * text button (one idiom per row, visual review polish), the line muted
   * because it names no unit.
   */
  proposed?: boolean;
  children: ReactNode;
}) {
  const [changing, setChanging] = useState(false);
  // A client-only act painted by the static shell; a tap before React owns it
  // is swallowed, so the suite waits on this flag (the instant-navigation
  // skill's "A static shell paints a control").
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  if (changing) return <>{children}</>;

  return (
    <div data-hydrated={hydrated ? "true" : undefined}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`min-w-0 flex-1 basis-20 break-words ${proposed ? "font-medium" : "text-muted"}`}
        >
          {copy.line}
        </span>
        <button
          type="button"
          onClick={() => setChanging(true)}
          className={buttonClass({
            variant: "ghost",
            size: "sm",
            flush: true,
            className: "min-w-11 max-w-full whitespace-normal break-words",
          })}
        >
          {copy.reveal}
        </button>
      </div>
    </div>
  );
}

/**
 * **Every proposal on the tab, in one tap.** Sends the picks the staffer is
 * looking at; the server reserves each through the same write a single pick
 * uses and says how many it could not. Those rows stay open for a person,
 * which is what the sentence under the button tells them.
 */
export function ConfirmProposals({
  tripId,
  picks,
  confirm,
  copy,
  className = "",
}: {
  tripId: string;
  picks: { bookingId: string; gearItemId: string }[];
  confirm: (input: {
    tripId: string;
    picks: { bookingId: string; gearItemId: string }[];
  }) => Promise<ConfirmProposalsResult>;
  copy: {
    action: string;
    pending: string;
    /** Said when any pick was refused; those rows stay open below. */
    refused: string;
    failed: string;
  };
  /** Placement from the section's header row. */
  className?: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <div
      className={`flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1 print:hidden ${className}`}
      data-hydrated={hydrated ? "true" : undefined}
    >
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await confirm({ tripId, picks });
            if (!result.ok) setMessage(copy.failed);
            else if (result.refused > 0) setMessage(copy.refused);
          });
        }}
        className={buttonClass({ className: "max-w-full whitespace-normal break-words" })}
      >
        {isPending ? copy.pending : copy.action}
      </button>
      {message ? (
        <p role="alert" className="text-sm font-medium text-warning-strong">
          {message}
        </p>
      ) : null}
    </div>
  );
}
