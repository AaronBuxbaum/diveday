"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";

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
 */
export function GearReturnPane({
  tripId,
  bookingId,
  action,
  labels,
}: {
  tripId: string;
  bookingId: string;
  action: (formData: FormData) => Promise<void>;
  labels: {
    allGood: string;
    fitAdjusted: string;
    serviceConcern: string;
    noteLabel: string;
    notePlaceholder: string;
  };
}) {
  const [concernOpen, setConcernOpen] = useState(false);

  return (
    <form action={action} className="mt-2 flex flex-col gap-2 print:hidden">
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="bookingId" value={bookingId} />
      <div className="flex flex-wrap items-center gap-2">
        {/* `formNoValidate` on both fast answers, and it is load-bearing:
            arming the concern puts a `required` note in the same form, and
            without this the browser refuses to submit "All good" until that
            field is filled — the fast path held hostage by a control the
            staffer opened and thought better of. Caught by the e2e, which taps
            the concern first on purpose. */}
        <button
          type="submit"
          name="outcome"
          value="all_good"
          formNoValidate
          className={buttonClass({ size: "sm" })}
        >
          {labels.allGood}
        </button>
        <button
          type="submit"
          name="outcome"
          value="fit_adjusted"
          formNoValidate
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {labels.fitAdjusted}
        </button>
        <button
          type="button"
          onClick={() => setConcernOpen(!concernOpen)}
          aria-expanded={concernOpen}
          className={buttonClass({ variant: concernOpen ? "secondary" : "ghost", size: "sm" })}
        >
          {labels.serviceConcern}
        </button>
      </div>
      {concernOpen ? (
        <div className="flex flex-col gap-2">
          <Field label={labels.noteLabel}>
            <input
              name="note"
              required
              maxLength={400}
              placeholder={labels.notePlaceholder}
              className={controlClass}
            />
          </Field>
          <div>
            <button
              type="submit"
              name="outcome"
              value="service_concern"
              className={buttonClass({ size: "sm" })}
            >
              {labels.serviceConcern}
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
