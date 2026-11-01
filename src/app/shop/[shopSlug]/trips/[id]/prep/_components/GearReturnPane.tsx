"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceFieldset, ChoiceRow, controlClass, Field } from "@/components/ui/form";

/**
 * Return one rental set with one outcome. Each submit button carries its own
 * `name`/`value`; the action's hidden fields identify the set, and `children`
 * accompany every answer. A service concern requires a note in
 * `returnTripGearSet`; it flags the reservation and does not create a
 * `gear_service_events` row. Optional `bench` pulls are explicit per-unit
 * choices, never automatic. While concern is open, fast answers are hidden;
 * Cancel discards the note and choices. Fit adjustment does not change the
 * diver profile.
 */
export function GearReturnPane({
  fields,
  action,
  labels,
  bench,
  children,
}: {
  fields: Record<string, string>;
  children?: ReactNode;
  bench?: { legend: string; units: { id: string; label: string; defaultChecked?: boolean }[] };
  action: (formData: FormData) => Promise<void>;
  labels: {
    allGood: string;
    /** Absent, the pane offers no fit answer: one unit off the boat (fifth-loop ideas, item 5). */
    fitAdjusted?: string;
    serviceConcern: string;
    /** Closes an open concern, discarding its note and ticks. */
    cancelConcern: string;
    noteLabel: string;
    notePlaceholder: string;
  };
}) {
  const [concernOpen, setConcernOpen] = useState(false);
  const noteRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  // Focus follows the act: into the note when the concern opens (its opener
  // is gone), back to the opener when it is cancelled. Skipped on first render.
  const opened = useRef(false);
  useEffect(() => {
    if (concernOpen) {
      opened.current = true;
      noteRef.current?.focus();
    } else if (opened.current) {
      openerRef.current?.focus();
    }
  }, [concernOpen]);

  return (
    <form action={action} className="mt-2 flex flex-col gap-2 print:hidden">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      {concernOpen ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {/* `formNoValidate` on both fast answers: harmless now that they are
              hidden while the concern's `required` note is open, and kept so
              a fast answer can never be held hostage by a control in the same
              form. */}
          <SubmitButton
            name="outcome"
            value="all_good"
            formNoValidate
            pendingLabel={labels.allGood}
            className={buttonClass({ size: "sm" })}
          >
            {labels.allGood}
          </SubmitButton>
          {labels.fitAdjusted ? (
            <SubmitButton
              name="outcome"
              value="fit_adjusted"
              formNoValidate
              pendingLabel={labels.fitAdjusted}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {labels.fitAdjusted}
            </SubmitButton>
          ) : null}
          <button
            ref={openerRef}
            type="button"
            onClick={() => setConcernOpen(true)}
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            {labels.serviceConcern}
          </button>
        </div>
      )}
      {concernOpen ? (
        <div className="flex flex-col gap-2">
          <Field label={labels.noteLabel}>
            <input
              ref={noteRef}
              name="note"
              required
              maxLength={400}
              placeholder={labels.notePlaceholder}
              className={controlClass}
            />
          </Field>
          {bench && bench.units.length > 0 ? (
            <ChoiceFieldset legend={bench.legend} bodyClassName="flex flex-col gap-1">
              {bench.units.map((unit) => (
                <ChoiceRow
                  key={unit.id}
                  type="checkbox"
                  name="pull"
                  value={unit.id}
                  defaultChecked={unit.defaultChecked ?? false}
                  className="text-sm"
                >
                  {unit.label}
                </ChoiceRow>
              ))}
            </ChoiceFieldset>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton
              name="outcome"
              value="service_concern"
              pendingLabel={labels.serviceConcern}
              className={buttonClass({ size: "sm" })}
            >
              {labels.serviceConcern}
            </SubmitButton>
            <button
              type="button"
              onClick={() => setConcernOpen(false)}
              className={buttonClass({ variant: "ghost", size: "sm" })}
            >
              {labels.cancelConcern}
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
