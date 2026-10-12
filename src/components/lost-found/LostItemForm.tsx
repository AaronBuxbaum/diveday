"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid, FormStatus } from "@/components/ui/form";

export type LostItemFormCopy = {
  description: string;
  seat: string;
  noSeat: string;
  submit: string;
  pending: string;
  recorded: string;
  refusals: Record<string, string> & { other: string };
};

export type RecordLostItemState =
  | { status: "recorded"; id: string }
  | { status: "refused"; reason: string };

/**
 * Write down something found aboard (batch 4, J2), optionally at a seat. The
 * seats are this departure's own; the server checks the one picked is.
 */
export function LostItemForm({
  action,
  seats,
  copy,
}: {
  action: (
    state: RecordLostItemState | undefined,
    formData: FormData,
  ) => Promise<RecordLostItemState>;
  seats: { bookingId: string; name: string }[];
  copy: LostItemFormCopy;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <FieldGrid
      as="form"
      action={formAction}
      columns={2}
      key={state?.status === "recorded" ? state.id : "form"}
      data-testid="lost-item-form"
    >
      <Field label={copy.description}>
        <input
          name="description"
          required
          maxLength={120}
          autoComplete="off"
          className={controlClass}
        />
      </Field>
      <Field label={copy.seat}>
        <select name="bookingId" defaultValue="" className={controlClass}>
          <option value="">{copy.noSeat}</option>
          {seats.map((seat) => (
            <option key={seat.bookingId} value={seat.bookingId}>
              {seat.name}
            </option>
          ))}
        </select>
      </Field>
      <FieldActions>
        <SubmitButton pendingLabel={copy.pending} className={buttonClass({ variant: "secondary" })}>
          {copy.submit}
        </SubmitButton>
        {state?.status === "recorded" ? (
          <FormStatus tone="success">{copy.recorded}</FormStatus>
        ) : state?.status === "refused" ? (
          <FormStatus>
            {Object.hasOwn(copy.refusals, state.reason)
              ? copy.refusals[state.reason]
              : copy.refusals.other}
          </FormStatus>
        ) : null}
      </FieldActions>
    </FieldGrid>
  );
}
