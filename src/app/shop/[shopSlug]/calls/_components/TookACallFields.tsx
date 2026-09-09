"use client";

import { useState } from "react";
import { controlClass, DateField, Field, FieldGrid } from "@/components/ui/form";
import {
  CALL_OUTCOMES,
  type CallOutcome,
  callOutcomeNeeds,
  isCallOutcome,
} from "@/lib/took-a-call";

export type TookACallCopy = {
  outcomeHeading: string;
  outcome: Record<CallOutcome, string>;
  departureLabel: string;
  departureUnchosen: string;
  noDepartures: string;
  interestLabel: string;
  interestPlaceholder: string;
  preferredDateLabel: string;
  diversLabel: string;
  noteLabel: string;
  optionalHint: string;
};

export type CallDeparture = { id: string; label: string };

/**
 * The half of "Took a call" that changes with the answer: which departure, or
 * what day they were asking for.
 *
 * **Every group is always in the DOM, and the inactive ones are `disabled`
 * fieldsets.** A `disabled` fieldset submits none of its controls and runs none
 * of their constraint validation, so this is behaviourally identical to
 * mounting the group only when it is chosen — with one difference that matters
 * here: the kept draft (ADR 20260906-before-you-ask, decision 3) is applied
 * once, on mount, by `applyFormFields` walking the controls that exist *at that
 * moment*. Mounted conditionally, a call interrupted halfway would come back
 * with the caller's name restored, the outcome radio re-clicked, and the
 * departure they had already chosen silently gone — a partial restore, which is
 * worse than none because nothing on screen says a field was dropped.
 *
 * The radios are uncontrolled with a delegated `onChange`, for the same reason:
 * `applyFormFields` restores a radio by `click()`ing it, and a delegated
 * handler hears that exactly the way it hears a staffer's own tap.
 */
export function TookACallFields({
  copy,
  departures,
  defaultOutcome = null,
}: {
  copy: TookACallCopy;
  departures: readonly CallDeparture[];
  /** What the last submission chose, so a refusal comes back on the same branch. */
  defaultOutcome?: CallOutcome | null;
}) {
  const [outcome, setOutcome] = useState<CallOutcome | null>(defaultOutcome);
  const needsDeparture = outcome !== null && callOutcomeNeeds(outcome, "departure");
  const isRequest = outcome === "date-request";

  return (
    <>
      <fieldset
        className="mt-6"
        onChange={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLInputElement) || target.name !== "outcome") return;
          if (isCallOutcome(target.value)) setOutcome(target.value);
        }}
      >
        <legend className="text-sm font-medium">
          {copy.outcomeHeading}
          {/* `Field`'s own required marker, by hand: a fieldset is not a
              `Field`, and a choice with no default is the one control on this
              form that must say it is mandatory. Aria-hidden and outside the
              accessible name, the same shape `Field` uses. */}
          <span aria-hidden="true" className="text-danger">
            {" "}
            *
          </span>
        </legend>
        <div className="mt-2 grid gap-2">
          {CALL_OUTCOMES.map((option) => (
            <label
              key={option}
              className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm hover:bg-surface"
            >
              <input
                type="radio"
                name="outcome"
                value={option}
                required
                defaultChecked={option === defaultOutcome}
              />
              {copy.outcome[option]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={!needsDeparture} className={needsDeparture ? "mt-6" : "hidden"}>
        {departures.length === 0 ? (
          <p className="text-sm text-muted">{copy.noDepartures}</p>
        ) : (
          <FieldGrid>
            <Field label={copy.departureLabel}>
              <select name="tripId" required defaultValue="" className={controlClass}>
                <option value="" disabled>
                  {copy.departureUnchosen}
                </option>
                {departures.map((departure) => (
                  <option key={departure.id} value={departure.id}>
                    {departure.label}
                  </option>
                ))}
              </select>
            </Field>
          </FieldGrid>
        )}
      </fieldset>

      <fieldset disabled={!isRequest} className={isRequest ? "mt-6" : "hidden"}>
        <FieldGrid columns={2}>
          <Field label={copy.interestLabel} className="sm:col-span-2">
            <input
              name="interest"
              required
              maxLength={200}
              placeholder={copy.interestPlaceholder}
              className={controlClass}
            />
          </Field>
          <Field label={copy.preferredDateLabel} hint={copy.optionalHint}>
            <DateField name="preferredDate" className="tabular-nums" />
          </Field>
          <Field label={copy.diversLabel} hint={copy.optionalHint}>
            <input
              name="divers"
              type="number"
              inputMode="numeric"
              min={1}
              max={12}
              className={controlClass}
            />
          </Field>
          <Field label={copy.noteLabel} hint={copy.optionalHint} className="sm:col-span-2">
            <textarea name="message" rows={3} maxLength={1500} className={controlClass} />
          </Field>
        </FieldGrid>
      </fieldset>
    </>
  );
}
