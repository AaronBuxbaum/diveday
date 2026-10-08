"use client";

import { type ReactNode, useEffect, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import type { AssignGearUnitResult } from "../actions";
import type { ConfirmProposalsResult } from "../proposal-actions";

export interface ProposedUnitCopy {
  /** "Proposed: BCD #4 · L" — said as a proposal, so it never reads as held. */
  proposed: string;
  assign: string;
  assigning: string;
  change: string;
  /** One sentence per refusal the write can answer with, keyed by its code. */
  refusals: Record<string, string>;
  refusalFallback: string;
}

/**
 * **One proposed unit, confirmed in one tap** (UX audit 2026-10-07, item 9).
 *
 * The row says which unit DiveDay would hand over and offers two acts:
 * Assign, which reserves exactly that unit through the same `assignGearUnit`
 * the picker uses (marked as a proposed pick, so its care is re-read), and Change, which opens the picker (`children`, the row's
 * own `RentalUnitPicker`) for a staffer who knows better. Nothing is held
 * until Assign: the proposal is a suggestion, and the exclusion constraint is
 * still the only thing that can say the unit is free. A refusal stays on the
 * row and opens the picker, because the one thing to do next is pick another.
 */
export function ProposedUnit({
  tripId,
  bookingId,
  gearItemId,
  assign,
  copy,
  children,
}: {
  tripId: string;
  bookingId: string;
  gearItemId: string;
  assign: (input: {
    tripId: string;
    bookingId: string;
    gearItemId: string;
    proposed?: boolean;
  }) => Promise<AssignGearUnitResult>;
  copy: ProposedUnitCopy;
  /** The row's picker, shown on Change or after a refusal. */
  children: ReactNode;
}) {
  const [changing, setChanging] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Both buttons are client-only acts painted by the static shell; a tap
  // before React owns them is swallowed, so the suite waits on this flag
  // (the instant-navigation skill's "A static shell paints a control").
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  if (changing) return <>{children}</>;

  return (
    <div className="flex flex-col gap-1" data-hydrated={hydrated ? "true" : undefined}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{copy.proposed}</span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setRefusal(null);
              startTransition(async () => {
                // Said as a proposal, so the server re-reads the unit's care too:
                // one that gained a lapsed clock or a concern since the page
                // loaded is refused rather than reserved unseen.
                const result = await assign({ tripId, bookingId, gearItemId, proposed: true });
                if (result.ok) return;
                setRefusal(copy.refusals[result.reason] ?? copy.refusalFallback);
                setChanging(true);
              });
            }}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {isPending ? copy.assigning : copy.assign}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => setChanging(true)}
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            {copy.change}
          </button>
        </span>
      </div>
      {refusal ? (
        <p role="alert" className="text-xs font-medium text-warning-strong">
          {refusal}
        </p>
      ) : null}
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
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 print:hidden"
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
        className={buttonClass()}
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
