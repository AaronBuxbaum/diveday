"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceFieldset, ChoicePill } from "@/components/ui/form";
import { RowActionForm } from "./RowActionForm";

/**
 * **"Turned away" — the desk saw this diver and would not board them**
 * (safety sheet 2026-10-15, item 6; H-135).
 *
 * **The door sits on the row's action side, beside its Blocked pill**
 * (visual review A08): `TurnAwayDoor`, a secondary "Turn away" button. The
 * confirm it opens is unchanged and still opens at the foot of the row
 * (`TurnAwayScript`, H-135): one confirm, every string a prop. Although the
 * roster places them in two slots, both halves share this row's React state
 * provider, so opening one panel cannot open another. What it adds is the reason, chosen
 * from this row's own blockers (`turnAwayReasons`, src/lib/turn-away.ts) and
 * only from them: the page passes the categories readiness shows, and the
 * writer refuses any other. A row with one reason has it chosen already.
 */
export type TurnAwayScriptCopy = {
  legend: string;
  consequence: string;
  confirm: string;
  confirming: string;
  /** Names the diver, so one row's confirm does not read like every other's. */
  confirmAriaLabel: string;
  sendFailed: string;
};

type TurnAwayRowState = { open: boolean; toggle: () => void };
const TurnAwayContext = createContext<TurnAwayRowState>({ open: false, toggle: () => {} });

/** Scope the door and panel to one roster row, even though their slots differ. */
export function TurnAwayRowStateProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <TurnAwayContext.Provider value={{ open, toggle: () => setOpen((was) => !was) }}>
      {children}
    </TurnAwayContext.Provider>
  );
}

/** The row's door: opens and closes the confirm at the row's foot. */
export function TurnAwayDoor({ bookingId, label }: { bookingId: string; label: string }) {
  const { open, toggle } = useContext(TurnAwayContext);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={`turn-away-${bookingId}`}
      onClick={toggle}
      className={buttonClass({ variant: "secondary", size: "sm", className: "print:hidden" })}
    >
      {label}
    </button>
  );
}

export function TurnAwayScript({
  action,
  bookingId,
  reasons,
  copy,
}: {
  action: (formData: FormData) => Promise<void>;
  bookingId: string;
  /** This row's reasons, each with its word: never empty (the page draws nothing then). */
  reasons: readonly { value: string; label: string }[];
  copy: TurnAwayScriptCopy;
}) {
  const only = reasons.length === 1;
  const { open } = useContext(TurnAwayContext);
  return (
    <div id={`turn-away-${bookingId}`} hidden={!open} className="pb-2 print:hidden">
      <RowActionForm action={action} sendFailedLabel={copy.sendFailed}>
        <input type="hidden" name="bookingId" value={bookingId} />
        <div className="mt-1 flex flex-col gap-3 rounded-lg bg-surface-sunken p-3">
          <ChoiceFieldset legend={copy.legend} required bodyClassName="flex flex-wrap gap-2">
            {reasons.map((reason) => (
              <ChoicePill
                key={reason.value}
                type="radio"
                name="reason"
                value={reason.value}
                required
                defaultChecked={only}
              >
                {reason.label}
              </ChoicePill>
            ))}
          </ChoiceFieldset>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <p className="min-w-0 grow text-sm text-muted">{copy.consequence}</p>
            <SubmitButton
              pendingLabel={copy.confirming}
              ariaLabel={copy.confirmAriaLabel}
              observabilityAction="turn_away"
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {copy.confirm}
            </SubmitButton>
          </div>
        </div>
      </RowActionForm>
    </div>
  );
}
