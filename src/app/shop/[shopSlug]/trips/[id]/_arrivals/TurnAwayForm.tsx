"use client";

import type { ReactNode } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceFieldset, ChoicePill } from "@/components/ui/form";
import { RowActionForm } from "./RowActionForm";

/** Reasons come from this row's blockers; the form requires a choice and
 * preselects a sole reason.
 */
export type TurnAwayCopy = {
  legend: string;
  consequence: string;
  confirm: string;
  confirming: string;
  /** Names the diver, so one row's confirm does not read like every other's. */
  confirmAriaLabel: string;
  sendFailed: string;
};

/**
 * The confirm itself: this row's reasons and the one button, as the opened
 * guest's sheet (its More menu), with "Never mind" beside it as every sheet has.
 */
export function TurnAwayForm({
  action,
  bookingId,
  reasons,
  copy,
  dismiss,
}: {
  action: (formData: FormData) => Promise<void>;
  bookingId: string;
  reasons: readonly { value: string; label: string }[];
  copy: TurnAwayCopy;
  /** "Never mind", beside the confirm as on every sheet of the opened guest. */
  dismiss?: ReactNode;
}) {
  const only = reasons.length === 1;
  return (
    <RowActionForm action={action} sendFailedLabel={copy.sendFailed}>
      <input type="hidden" name="bookingId" value={bookingId} />
      <div className="flex flex-col gap-3">
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
        <p className="text-sm">{copy.consequence}</p>
        <div className="flex flex-wrap gap-3">
          <SubmitButton
            pendingLabel={copy.confirming}
            ariaLabel={copy.confirmAriaLabel}
            observabilityAction="turn_away"
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {copy.confirm}
          </SubmitButton>
          {dismiss}
        </div>
      </div>
    </RowActionForm>
  );
}
