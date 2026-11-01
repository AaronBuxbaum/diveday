"use client";

import { type ReactNode, useEffect, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import type { ConfirmProposalsResult } from "../proposal-actions";

export interface ProposedUnitCopy {
  /** Proposal wording must not imply a reservation; otherwise say no unit yet. */
  line: string;
  /** "Change", or "Pick" where nothing is proposed. */
  reveal: string;
}

/** A proposal names a suggested unit but reserves nothing; Change reveals its picker. */
export function ProposedUnit({
  copy,
  proposed = true,
  children,
}: {
  copy: ProposedUnitCopy;
  /** False when there is no proposed unit; the line is muted. */
  proposed?: boolean;
  children: ReactNode;
}) {
  const [changing, setChanging] = useState(false);
  // Keep client-only controls inert until hydration completes.
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
            className: "min-w-12 max-w-full whitespace-normal break-words",
          })}
        >
          {copy.reveal}
        </button>
      </div>
    </div>
  );
}

/** Confirm all visible proposals together; refused picks remain open for staff. */
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
