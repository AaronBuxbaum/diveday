"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceFieldset, ChoiceRow, controlClass, Field } from "@/components/ui/form";

/**
 * **One diver's rental set, coming home** (issue #1186, delight report D26).
 *
 * A counter is handed an armful at 4pm by somebody who wants to go home, so
 * the ordinary evening is one tap: **All good**, and the whole set is closed.
 * That is the ticket's boundary — "default to a fast all-good path" — and it is
 * why the outcome is asked once for the set rather than once per piece.
 *
 * **Each outcome is its own submit button carrying its own value.** A submit
 * button's `name`/`value` reaches the form data, so there is no hidden field to
 * keep in step with a selection and no way for a tap on one answer to post
 * another. The only state here is whether the note is open.
 *
 * **A service concern asks for words before it will save.** A flag with no note
 * is something a technician cannot act on, so that one button opens a field
 * instead of submitting, and `returnTripGearSet` refuses the write without it —
 * in the domain writer rather than this form, so the register's own
 * single-unit return obeys the same rule. "Fit adjusted" opens nothing: the
 * fact *is* that the fit was adjusted, and writing the new size onto the
 * diver's profile is #1174's mutation, not this one's.
 *
 * **What it deliberately does not do**: write a `gear_service_events` row.
 * Those drive the clocks a shop uses to decide when a regulator gets bench
 * time, and a busy desk tapping "concern" for a scratched mask would turn
 * "this needs a technician" into "somebody was mildly annoyed". The concern is
 * a flag on the reservation that a technician promotes deliberately, and it
 * shows on the unit's own page where they are already looking.
 *
 * **The set is whatever the action's hidden fields name** — a booking on a
 * departure here, a counter rental's ticket on `/gear/rentals` — so one pane
 * asks the one question wherever a set comes home. `children` is anything else
 * that set's return asks beside the outcome (a counter rental's dive count),
 * posted with whichever answer is tapped.
 *
 * **`bench` offers to pull units to Needs service with the concern** (issue
 * #2205): one checkbox per unit in the set, every one unticked, and only once
 * the concern is open. Never automatic — a scratched mask and a free-flowing
 * regulator are both concerns, and auto-pulling every one would turn the flag
 * into a pager nobody trusts. Absent, the pane asks nothing extra.
 *
 * **An open concern is the only answer on offer** (dive-domain review). With
 * the note and the boxes open, "All good" and "Fit adjusted" are hidden: a tap
 * on either used to post the set as fine and throw away the typed concern and
 * every tick. The way out is Cancel, which closes the concern and brings the
 * fast answers back.
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
  bench?: { legend: string; units: { id: string; label: string }[] };
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
